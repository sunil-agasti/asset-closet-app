import { NextRequest, NextResponse } from "next/server";
import { readCSV, writeCSV } from "@/lib/csv";
import { encryptPin } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { sanitizeDigits, sanitizeString } from "@/lib/sanitize";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const emp_id = sanitizeDigits(body.emp_id);
  const pin = sanitizeDigits(body.pin);
  const confirm_pin = sanitizeDigits(body.confirm_pin);
  const security_question = sanitizeString(body.security_question);
  const security_answer = sanitizeString(body.security_answer);
  const mode = sanitizeString(body.mode);

  const clientIp = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkRateLimit(`pin:${clientIp}:${emp_id}`, 5, 60000)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a minute." }, { status: 429 });
  }

  if (!emp_id) {
    return NextResponse.json({ error: "Employee ID required" }, { status: 400 });
  }

  const users = readCSV("users.csv");
  const idx = users.findIndex((u) => String(u["Emp_ID"]).trim() === String(emp_id).trim());

  if (idx === -1) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be exactly 4 digits" }, { status: 400 });
  }
  if (pin !== confirm_pin) {
    return NextResponse.json({ error: "PINs do not match" }, { status: 400 });
  }
  if (!security_question || security_question === "Select security question") {
    return NextResponse.json({ error: "Security question is required" }, { status: 400 });
  }
  if (!security_answer || !security_answer.trim()) {
    return NextResponse.json({ error: "Security answer is required" }, { status: 400 });
  }

  if (mode === "reset") {
    const storedQ = (users[idx]["Security Question"] || "").trim();
    const storedA = (users[idx]["Security Answer"] || "").trim().toLowerCase();

    if (!storedQ || !storedA) {
      return NextResponse.json({ error: "Security details not set. Contact admin." }, { status: 400 });
    }
    if (security_question.trim() !== storedQ || security_answer.trim().toLowerCase() !== storedA) {
      return NextResponse.json({ error: "Security question or answer is incorrect" }, { status: 401 });
    }
  } else {
    if (users[idx]["PIN"] && users[idx]["PIN"].trim().length > 0) {
      return NextResponse.json({ error: "PIN already set. Use Forgot PIN to reset." }, { status: 400 });
    }
  }

  users[idx]["PIN"] = encryptPin(pin);
  users[idx]["Last_PIN_Set"] = new Date().toISOString().replace("T", " ").slice(0, 26);

  if (mode !== "reset") {
    users[idx]["Security Question"] = security_question.trim();
    users[idx]["Security Answer"] = security_answer.trim().toLowerCase();
  }

  writeCSV("users.csv", users);

  return NextResponse.json({ success: true });
}
