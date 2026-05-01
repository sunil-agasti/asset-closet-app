import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appendAssetRow, readAssetRows, readLatestAssetRows, getAssetLocations } from "@/lib/assets-store";
import { normalizeAssetPayload } from "@/lib/asset-fields";
import { normalizeAssetStatus } from "@/lib/asset-status";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("mode") || "latest";
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "25");
  const requestedLocation = (searchParams.get("location") || "").trim();
  const locations = getAssetLocations();
  const defaultLocation = locations.includes("Austin") ? "Austin" : (locations[0] || "");
  const selectedLocation = locations.includes(requestedLocation) ? requestedLocation : defaultLocation;

  if (mode === "locations") {
    return NextResponse.json({ locations });
  }

  const allRows = mode === "latest"
    ? readLatestAssetRows(selectedLocation || undefined)
    : readAssetRows(selectedLocation || undefined);

  let rows = allRows;

  // Sort: unallocated first
  rows.sort((a, b) => {
    const aUnalloc = (a.Status || "").toLowerCase().includes("unallocated") ? 0 : 1;
    const bUnalloc = (b.Status || "").toLowerCase().includes("unallocated") ? 0 : 1;
    return aUnalloc - bUnalloc;
  });

  // Server-side status filter
  const statusFilter = searchParams.get("statusFilter") || "";
  if (statusFilter === "unallocated") {
    rows = rows.filter((r) => {
      const s = (r.Status || "").trim().toLowerCase();
      return s === "inventory - unallocated" || s === "unallocated";
    });
  }

  if (search) {
    const q = search.toLowerCase();
    const qNorm = q.replace(/[\s\-\/]/g, "");
    rows = rows.filter((r) => {
      const vals = Object.values(r).join(" ").toLowerCase();
      if (vals.includes(q)) return true;
      if (vals.replace(/[\s\-\/]/g, "").includes(qNorm)) return true;
      const tokens = q.split(" ").filter(Boolean);
      return tokens.every((t) => vals.includes(t));
    });
  }

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = rows.slice(start, start + pageSize);

  return NextResponse.json({ rows: paged, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role === "viewer") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const normalizedBody = normalizeAssetPayload(body);

  const serial = normalizedBody["Serial Number"] || "";
  const chip = normalizedBody.Chip || "";

  if (!serial) return NextResponse.json({ error: "Serial Number is required" }, { status: 400 });
  if (!chip) return NextResponse.json({ error: "Chip is required" }, { status: 400 });

  const row: Record<string, string> = {
    ...normalizedBody,
    "Asset ID": normalizedBody["Asset ID"] || serial,
    "Serial Number": serial,
    "Asset Type": normalizedBody["Asset Type"] || "Laptop",
    Chip: chip,
    Status: normalizeAssetStatus(normalizedBody.Status || "Working - Warranty"),
    Reason: "Check-In",
    Date: now,
    "Action By": `${session.name} (${session.emp_id})`,
  };

  appendAssetRow(row);

  return NextResponse.json({ success: true, message: `Asset ${serial} checked in successfully` });
}
