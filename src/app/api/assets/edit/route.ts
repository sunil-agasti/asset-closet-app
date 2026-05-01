import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAssetRow, readLatestAssetRows } from "@/lib/assets-store";
import { NON_EDITABLE_ASSET_FIELDS, normalizeAssetFieldName, normalizeAssetFieldValue } from "@/lib/asset-fields";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const serial = (body.serial || "").trim();
  if (!serial) return NextResponse.json({ error: "Serial Number is required" }, { status: 400 });

  const latest = readLatestAssetRows();
  const existing = latest.find((r) => r["Serial Number"].trim() === serial);
  if (!existing) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

  const updates = body.updates as Record<string, string>;
  const changes: string[] = [];
  const newRow = { ...existing };

  for (const [rawField, rawValue] of Object.entries(updates)) {
    const field = normalizeAssetFieldName(rawField);
    if (NON_EDITABLE_ASSET_FIELDS.has(field) || field.startsWith("Prev")) continue;

    const oldVal = (existing[field] || "").trim();
    const newVal = normalizeAssetFieldValue(field, rawValue);
    if (oldVal !== newVal) {
      changes.push(`${field}: '${oldVal}' -> '${newVal}'`);
      newRow[field] = newVal;
    }
  }

  if (changes.length === 0) {
    return NextResponse.json({ error: "No changes detected" }, { status: 400 });
  }

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  newRow.Reason = `Inventory Edit | ${changes.join("; ")}`;
  newRow.Date = now;
  newRow["Action By"] = `${session.name} (${session.emp_id})`;

  appendAssetRow(newRow);

  return NextResponse.json({ success: true, message: `Saved changes for ${newRow["Asset ID"]}` });
}
