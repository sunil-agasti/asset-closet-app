import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readCSV } from "@/lib/csv";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rows = readCSV("login_audit.csv");
  rows.sort((a, b) => {
    const da = new Date(a["Login Time"] || 0).getTime();
    const db = new Date(b["Login Time"] || 0).getTime();
    return db - da;
  });

  return NextResponse.json({ rows, total: rows.length });
}
