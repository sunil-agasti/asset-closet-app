import { NextRequest, NextResponse } from "next/server";
import { readCSV } from "@/lib/csv";
import { verifyPin } from "@/lib/crypto";
import { createSession } from "@/lib/auth";
import { appendCSVRow } from "@/lib/csv";
import { checkRateLimit } from "@/lib/rate-limit";
import { sanitizeDigits } from "@/lib/sanitize";
import type { UserRole } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const emp_id = sanitizeDigits(body.emp_id);
  const pin = sanitizeDigits(body.pin);

  if (!emp_id) {
    return NextResponse.json({ error: "Employee ID is required" }, { status: 400 });
  }

  const clientIp = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(`login:${clientIp}:${emp_id}`, 10, 60000)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  const users = readCSV("users.csv");
  const user = users.find((u) => String(u["Emp_ID"]).trim() === String(emp_id).trim());

  if (!user) {
    const device = req.headers.get("x-device") || "Unknown";
    appendCSVRow("login_audit.csv", {
      "Emp ID": String(emp_id),
      Name: "",
      "Login Time": new Date().toISOString().replace("T", " ").slice(0, 19),
      "Logout Time": "",
      "Total Seconds": "",
      "Total Minutes": "",
      "Logout Method": "Invalid Employee ID",
      "Login Failure": "Invalid Employee ID",
      "Logged In Device": device,
    });
    return NextResponse.json({ error: "Invalid Employee ID" }, { status: 401 });
  }

  if (!pin) {
    const hasPIN = user["PIN"] && user["PIN"].trim().length > 0;
    return NextResponse.json({
      step: hasPIN ? "enter_pin" : "set_pin",
      name: user["Name"],
      has_pin: hasPIN,
      security_question: user["Security Question"] || "",
    });
  }

  const storedPin = user["PIN"] || "";
  if (!storedPin.trim()) {
    return NextResponse.json({ step: "set_pin", name: user["Name"] });
  }

  if (!verifyPin(storedPin, pin)) {
    const device = req.headers.get("x-device") || "Unknown";
    appendCSVRow("login_audit.csv", {
      "Emp ID": String(emp_id),
      Name: user["Name"],
      "Login Time": new Date().toISOString().replace("T", " ").slice(0, 19),
      "Logout Time": "",
      "Total Seconds": "",
      "Total Minutes": "",
      "Logout Method": "Incorrect PIN",
      "Login Failure": "Incorrect PIN",
      "Logged In Device": device,
    });
    return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
  }

  const device = req.headers.get("x-device") || "Unknown";
  appendCSVRow("login_audit.csv", {
    "Emp ID": String(emp_id),
    Name: user["Name"],
    "Login Time": new Date().toISOString().replace("T", " ").slice(0, 19),
    "Logout Time": "",
    "Total Seconds": "",
    "Total Minutes": "",
    "Logout Method": "",
    "Login Failure": "",
    "Logged In Device": device,
  });

  const token = await createSession({
    emp_id: String(user["Emp_ID"]),
    name: user["Name"],
    role: user["Role"] as UserRole,
  });

  const response = NextResponse.json({
    success: true,
    user: { emp_id: user["Emp_ID"], name: user["Name"], role: user["Role"] },
  });

  response.cookies.set("ac_user_emp", String(user["Emp_ID"]), { path: "/" });
  response.cookies.set("ac_user_name", encodeURIComponent(user["Name"]), { path: "/" });
  response.cookies.set("ac_user_role", user["Role"], { path: "/" });

  return response;
}
