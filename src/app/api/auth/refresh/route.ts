import { NextResponse } from "next/server";
import { getSession, createSession } from "@/lib/auth";

const MAX_SESSION_MS = 8 * 60 * 60 * 1000; // 8 hours absolute max

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const iat = (session as unknown as Record<string, number>).iat;
  if (iat && Date.now() - iat * 1000 > MAX_SESSION_MS) {
    return NextResponse.json({ error: "Session expired. Please log in again." }, { status: 401 });
  }

  await createSession({
    emp_id: session.emp_id,
    name: session.name,
    role: session.role,
  });

  return NextResponse.json({ success: true });
}
