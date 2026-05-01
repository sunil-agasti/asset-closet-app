import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { readAssetRows, readLatestAssetRows, getAssetLocations, getAssetWorkbookMtime } from "@/lib/assets-store";
import { normalizeAssetStatus } from "@/lib/asset-status";

let cachedReports = new Map<string, { version: number; payload: Record<string, unknown> }>();

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const locations = getAssetLocations();
  const requestedLocation = (searchParams.get("location") || "").trim();
  const defaultLocation = locations.includes("Austin") ? "Austin" : (locations[0] || "");
  const selectedLocation = locations.includes(requestedLocation) ? requestedLocation : defaultLocation;
  const cacheKey = `${selectedLocation || "__all__"}::${locations.join("|") || "none"}`;
  const workbookVersion = getAssetWorkbookMtime();
  const cached = cachedReports.get(cacheKey);

  if (cached && cached.version === workbookVersion) {
    return NextResponse.json(cached.payload);
  }

  const allRows = readAssetRows(selectedLocation || undefined);
  const latest = readLatestAssetRows(selectedLocation || undefined);
  const total = allRows.length;
  const current = latest.length;

  const getStatus = (row: Record<string, string>) => normalizeAssetStatus(row.Status || "Unknown");
  const countByStatus = (fn: (s: string) => boolean) => allRows.filter((r) => fn(getStatus(r))).length;

  const isUnallocated = (s: string) => {
    const sl = s.toLowerCase().trim();
    return sl === "inventory - unallocated" || sl === "unallocated";
  };

  const overview = {
    total,
    current,
    inUse: countByStatus((s) => s.startsWith("In Use") || s.includes("Working")),
    available: countByStatus((s) => isUnallocated(s)),
    loaner: countByStatus((s) => s.toLowerCase().includes("loaner")),
    repair: countByStatus((s) => s.toLowerCase().includes("repair")),
    brokenEdison: countByStatus((s) => s === "Broken - Send to Edison" || s === "Not Working - Ship to Edison"),
    sentEdison: countByStatus((s) => s === "Sent to Edison"),
    specialCase: countByStatus((s) => s.toLowerCase().includes("special case")),
    returned: countByStatus((s) => s.toLowerCase().includes("returned") || s.toLowerCase().includes("handeded over")),
  };

  const mChipCount = allRows.filter(r => {
    const chip = (r.Chip || "").trim();
    return /^M\d/i.test(chip);
  }).length;
  const intelChipCount = allRows.filter(r => {
    const chip = (r.Chip || "").trim().toLowerCase();
    return chip === "intel" || chip.startsWith("intel");
  }).length;

  const statusBreakdown: Record<string, number> = {};
  allRows.forEach((r) => {
    const s = getStatus(r) || "Unknown";
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1;
  });

  const byYear: Record<string, { total: number; inUse: number; available: number; loaner: number; repair: number; brokenEdison: number; sentEdison: number; special: number; other: number }> = {};
  allRows.forEach((r) => {
    const y = (r["Year"] || "").trim();
    if (!y) return;
    if (!byYear[y]) byYear[y] = { total: 0, inUse: 0, available: 0, loaner: 0, repair: 0, brokenEdison: 0, sentEdison: 0, special: 0, other: 0 };
    byYear[y].total++;
    const s = getStatus(r);
    const sLower = s.toLowerCase();
    let matched = false;
    if (sLower.includes("working") || sLower.startsWith("in use")) { byYear[y].inUse++; matched = true; }
    if (isUnallocated(s)) { byYear[y].available++; matched = true; }
    if (sLower.includes("loaner")) { byYear[y].loaner++; matched = true; }
    if (sLower.includes("repair")) { byYear[y].repair++; matched = true; }
    if (s === "Broken - Send to Edison" || s === "Not Working - Ship to Edison") { byYear[y].brokenEdison++; matched = true; }
    if (s === "Sent to Edison") { byYear[y].sentEdison++; matched = true; }
    if (sLower.includes("special")) { byYear[y].special++; matched = true; }
    if (!matched) byYear[y].other++;
  });

  const byType: Record<string, number> = {};
  allRows.forEach((r) => {
    const t = (r["Asset Type"] || "Unknown").trim();
    byType[t] = (byType[t] || 0) + 1;
  });

  const byProcessor: Record<string, number> = {};
  allRows.forEach((r) => {
    const p = (r["Chip"] || "").trim();
    if (p) byProcessor[p] = (byProcessor[p] || 0) + 1;
  });

  const byLocation: Record<string, number> = {};
  allRows.forEach((r) => {
    const l = (r.Location || "").trim();
    if (l) byLocation[l] = (byLocation[l] || 0) + 1;
  });

  const topAssigned: Record<string, number> = {};
  allRows.forEach((r) => {
    const a = (r["Current User"] || "").trim();
    if (a) topAssigned[a] = (topAssigned[a] || 0) + 1;
  });

  const checkoutsByUser: Record<string, number> = {};
  const checkinsByUser: Record<string, number> = {};
  const editsByUser: Record<string, number> = {};
  allRows.forEach((r) => {
    const reason = (r.Reason || "").trim().toLowerCase();
    const actor = (r["Action By"] || "").trim();
    if (!actor) return;
    if (reason.includes("check-out")) checkoutsByUser[actor] = (checkoutsByUser[actor] || 0) + 1;
    if (reason.includes("check-in")) checkinsByUser[actor] = (checkinsByUser[actor] || 0) + 1;
    if (reason.includes("inventory edit")) editsByUser[actor] = (editsByUser[actor] || 0) + 1;
  });

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = allRows.filter((r) => {
    const d = new Date(r.Date || "").getTime();
    return d >= thirtyDaysAgo;
  });
  const recentActivity = {
    checkIns: recent.filter((r) => (r.Reason || "").toLowerCase().includes("check-in")).length,
    checkOuts: recent.filter((r) => (r.Reason || "").toLowerCase().includes("check-out")).length,
    edits: recent.filter((r) => (r.Reason || "").toLowerCase().includes("inventory edit")).length,
  };

  const topCheckedIn: Record<string, number> = {};
  const topCheckedOut: Record<string, number> = {};
  allRows.forEach((r) => {
    const reason = (r.Reason || "").toLowerCase();
    const aid = (r["Asset ID"] || "").trim();
    if (!aid) return;
    if (reason.includes("check-in")) topCheckedIn[aid] = (topCheckedIn[aid] || 0) + 1;
    if (reason.includes("check-out")) topCheckedOut[aid] = (topCheckedOut[aid] || 0) + 1;
  });

  const sheetLocations: Record<string, number> = {};
  try {
    for (const loc of locations) {
      const locRows = readAssetRows(loc);
      sheetLocations[loc] = locRows.length;
    }
  } catch { /* ignore */ }

  const payload = {
    selectedLocation,
    availableLocations: locations,
    overview,
    mChipCount,
    intelChipCount,
    statusBreakdown,
    byYear,
    byType,
    byProcessor,
    byLocation,
    sheetLocations,
    topAssigned: sortObj(topAssigned, 15),
    checkoutsByUser: sortObj(checkoutsByUser, 10),
    checkinsByUser: sortObj(checkinsByUser, 10),
    editsByUser: sortObj(editsByUser, 10),
    recentActivity,
    topCheckedIn: sortObj(topCheckedIn, 10),
    topCheckedOut: sortObj(topCheckedOut, 10),
  };

  cachedReports.set(cacheKey, { version: workbookVersion, payload });
  if (cachedReports.size > 10) {
    const firstKey = cachedReports.keys().next().value;
    if (firstKey) cachedReports.delete(firstKey);
  }

  return NextResponse.json(payload);
}

function sortObj(obj: Record<string, number>, limit: number): [string, number][] {
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);
}
