import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAssetRow, readLatestAssetRows } from "@/lib/assets-store";
import { sanitizeDigits } from "@/lib/sanitize";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const assetId = (body["Asset ID"] || "").trim();
  const assignedTo = (body["Current User"] || "").trim().toUpperCase();
  const empId = sanitizeDigits(body["Emp ID"] || "");

  if (!assetId) return NextResponse.json({ error: "Asset ID is required" }, { status: 400 });
  if (!assignedTo) return NextResponse.json({ error: "Current User is required" }, { status: 400 });

  const latest = readLatestAssetRows();
  const asset = latest.find((r) => r["Asset ID"].trim() === assetId);

  if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  if (asset.Status === "Special Case") {
    return NextResponse.json({ error: "Cannot check out a Special Case asset" }, { status: 400 });
  }

  const reason = (asset.Reason || "").trim().toLowerCase();
  if (reason === "check-out" || reason === "check out") {
    return NextResponse.json({ error: `Asset already checked out to ${asset["Current User"]}` }, { status: 400 });
  }

  const assetConfiguration = asset.Configuration || asset.Config;
  if (assetConfiguration === "M4-24") {
    const m4Count = latest.filter(
      (r) => r["Asset Type"] === "Laptop" && (r.Configuration || r.Config) === "M4-24" && r.Status === "Inventory - Unallocated"
    ).length;
    if (m4Count <= 3) {
      return NextResponse.json({ error: `Below minimum stock threshold. Only ${m4Count} M4-24 units remaining (3 required)` }, { status: 400 });
    }
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const row: Record<string, string> = {
    ...asset,
    "Current User": assignedTo,
    "Emp ID": empId,
    Status: "In Use",
    Reason: "Check-Out",
    Date: now,
    "Action By": `${session.name} (${session.emp_id})`,
  };

  appendAssetRow(row);

  return NextResponse.json({ success: true, message: `Check-Out completed for ${assetId}` });
}
