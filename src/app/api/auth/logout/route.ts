import { NextRequest, NextResponse } from "next/server";
import { destroySession, getSession } from "@/lib/auth";
import { readCSV, writeCSV } from "@/lib/csv";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ success: true });

  const device = req.headers.get("x-device") || "Unknown";
  const { reason } = await req.json().catch(() => ({ reason: "User Logout" }));

  const rows = readCSV("login_audit.csv");
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]["Emp ID"] === session.emp_id && !rows[i]["Logout Time"]) {
      const loginTime = new Date(rows[i]["Login Time"].replace(" ", "T"));
      const now = new Date();
      if (isNaN(loginTime.getTime())) {
        rows[i]["Total Seconds"] = "0";
        rows[i]["Total Minutes"] = "0";
      } else {
        const totalSeconds = Math.floor((now.getTime() - loginTime.getTime()) / 1000);
        rows[i]["Total Seconds"] = String(totalSeconds);
        rows[i]["Total Minutes"] = (totalSeconds / 60).toFixed(1);
      }
      rows[i]["Logout Time"] = new Date().toISOString().replace("T", " ").slice(0, 19);
      rows[i]["Logout Method"] = reason || "User Logout";
      break;
    }
  }
  writeCSV("login_audit.csv", rows);
  await destroySession();
  const response = NextResponse.json({ success: true });
  response.cookies.delete("ac_user_emp");
  response.cookies.delete("ac_user_name");
  response.cookies.delete("ac_user_role");
  return response;
}
