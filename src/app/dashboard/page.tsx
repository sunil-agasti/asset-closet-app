"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { STATUS_COLORS, STATUS_OPTIONS } from "@/lib/constants";
import { normalizeAssetStatus } from "@/lib/asset-status";
import CameraScanner from "./camera-scanner";

type Tab = "Check-In" | "Check-Out" | "Inventory" | "User Audit" | "Asset Log" | "Reports";
type UserRole = "admin" | "editor" | "viewer";
interface User { emp_id: string; name: string; role: UserRole; }
type ReportsResponse = Record<string, unknown>;

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function parseDateValue(value?: string) {
  if (!value?.trim()) return 0;
  const direct = new Date(value.trim()).getTime();
  if (!Number.isNaN(direct)) return direct;
  const normalized = new Date(value.trim().replace(" ", "T")).getTime();
  return Number.isNaN(normalized) ? 0 : normalized;
}

function getSortedAssetLogRows(rows: Record<string, string>[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => Boolean(row.Date))
    .sort((a, b) => {
      const timeDiff = parseDateValue(b.row.Date) - parseDateValue(a.row.Date);
      if (timeDiff !== 0) return timeDiff;
      return b.index - a.index;
    })
    .map(({ row }) => row);
}

const SYSTEM_ASSET_FIELDS = new Set(["Reason", "Date", "Action By", "Status", "Location"]);
const DEFAULT_LOCATION = "Austin";

function getStatusLabel(status?: string) {
  return normalizeAssetStatus(status || "");
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tab, setTab] = useState<Tab>("Check-In");
  const [dark, setDark] = useState(false);
  const [assets, setAssets] = useState<Record<string, string>[]>([]);
  const [allAssets, setAllAssets] = useState<Record<string, string>[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [flash, setFlash] = useState<{ type: string; msg: string } | null>(null);

  useEffect(() => {
    if (flash) {
      const t = setTimeout(() => setFlash(null), 2000);
      return () => clearTimeout(t);
    }
  }, [flash]);
  const [editAsset, setEditAsset] = useState<Record<string, string> | null>(null);
  const [auditRows, setAuditRows] = useState<Record<string, string>[]>([]);
  const [reports, setReports] = useState<ReportsResponse | null>(null);
  const [reportsTab, setReportsTab] = useState("status");
  const [reportsLocation, setReportsLocation] = useState(DEFAULT_LOCATION);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [checkoutAssets, setCheckoutAssets] = useState<Record<string, string>[]>([]);
  const [hideUnavailable, setHideUnavailable] = useState(true);
  const [fullscreen, setFullscreen] = useState("");
  const [gearOpen, setGearOpen] = useState("");
  const reportsCacheRef = useRef<Record<string, ReportsResponse>>({});
  const inventoryCacheRef = useRef<Record<string, { rows: Record<string, string>[]; total: number }>>({});
  const allAssetsCacheRef = useRef<Record<string, { rows: Record<string, string>[]; unallocatedCount: number }>>({});
  const checkoutAssetsCacheRef = useRef<Record<string, Record<string, string>[]>>({});
  const locationsLoadedRef = useRef(false);

  useEffect(() => {
    if (!gearOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".inv-gear-btn") && !target.closest(".inv-gear-menu")) setGearOpen("");
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [gearOpen]);

  const exportWorkbook = async (data: Record<string, string>[], filename: string) => {
    if (!data.length) return;

    const XLSX = await import("xlsx");
    const cols = Object.keys(data[0]);
    const rows = data.map((row) =>
      cols.reduce<Record<string, string>>((acc, col) => {
        acc[col] = row[col] || "";
        return acc;
      }, {})
    );

    const sheet = XLSX.utils.json_to_sheet(rows, { header: cols });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Export");

    const output = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
      compression: true,
    });

    const blob = new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const GearMenu = ({ id, data, filename }: { id: string; data: Record<string, string>[]; filename: string }) => (
    <div style={{ position: "relative" }}>
      <button className="inv-gear-btn" onClick={() => setGearOpen(gearOpen === id ? "" : id)} title="Table tools">⚙</button>
      {gearOpen === id && (
        <div className="inv-gear-menu">
          {id === "inv" && <button onClick={() => { setHideUnavailable(!hideUnavailable); setPage(1); setGearOpen(""); }}>{hideUnavailable ? "👁 Show All Assets" : "🙈 Show Available Only"}</button>}
          {id === "inv" && <button onClick={() => { setShowAllCols(!showAllCols); setGearOpen(""); }}>{showAllCols ? "📋 Show Default Columns" : "📋 Show All Columns"}</button>}
          <button onClick={() => { setFullscreen(fullscreen === id ? "" : id); setGearOpen(""); }}>{fullscreen === id ? "✕ Exit Fullscreen" : "⤢ Fullscreen"}</button>
          <button onClick={async () => {
            await exportWorkbook(data, filename);
            setGearOpen("");
          }}>⬇ Export Excel</button>
        </div>
      )}
    </div>
  );
  const [unallocatedCount, setUnallocatedCount] = useState(0);
  const [selectedCheckout, setSelectedCheckout] = useState("");
  const [checkoutSearch, setCheckoutSearch] = useState("");
  const [checkoutDropdownOpen, setCheckoutDropdownOpen] = useState(false);

  useEffect(() => {
    if (!checkoutDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".checkout-combo")) setCheckoutDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [checkoutDropdownOpen]);
  const [auditPage, setAuditPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [auditPageSize, setAuditPageSize] = useState(25);
  const [logPageSize, setLogPageSize] = useState(25);
  const [assetLocations, setAssetLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState(DEFAULT_LOCATION);
  const [locationLoading, setLocationLoading] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);
  const ROWS_PER_PAGE = 25;
  const DEFAULT_INVENTORY_COLS = ["Chip", "Status", "Year", "Current User"];
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(30);

  useEffect(() => {
    const saved = localStorage.getItem("ac_theme");
    if (saved === "dark") { setDark(true); document.documentElement.setAttribute("data-theme", "dark"); }

    const pending = sessionStorage.getItem("ac_refresh_logout");
    if (pending) {
      sessionStorage.removeItem("ac_refresh_logout");
      fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Page Refresh" }) })
        .then(() => { window.location.href = "/"; });
      return;
    }

    const beforeUnload = () => { if (user) sessionStorage.setItem("ac_refresh_logout", "1"); };
    window.addEventListener("beforeunload", beforeUnload);

    fetchUser();
    fetchCheckoutAssets();
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [router]);

  const fetchUser = async () => {
    try {
      const meRes = await fetch("/api/auth/me");
      if (meRes.status === 401) { router.push("/"); return; }
      const me = await meRes.json();
      if (!me.emp_id) { router.push("/"); return; }
      setUser({ emp_id: me.emp_id, name: me.name, role: me.role as UserRole });
      if (me.role === "viewer") setTab("Inventory");
    } catch { router.push("/"); }
  };

  const fetchAssets = useCallback(async () => {
    const cacheKey = JSON.stringify([selectedLocation || "", search, page, pageSize, hideUnavailable]);
    const cached = inventoryCacheRef.current[cacheKey];
    if (cached) {
      setAssets(cached.rows);
      setTotalAssets(cached.total);
      setLocationLoading(false);
      return;
    }

    setLocationLoading(true);
    try {
      const locParam = selectedLocation ? `&location=${encodeURIComponent(selectedLocation)}` : "";
      const statusParam = hideUnavailable ? "&statusFilter=unallocated" : "";
      const res = await fetch(`/api/assets?mode=latest&search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}${locParam}${statusParam}`);
      if (res.ok) {
        const data = await res.json();
        inventoryCacheRef.current[cacheKey] = { rows: data.rows, total: data.total };
        setAssets(data.rows);
        setTotalAssets(data.total);
      }
    } catch { /* ignore */ }
    setLocationLoading(false);
  }, [search, page, pageSize, selectedLocation, hideUnavailable]);

  const fetchAllAssets = useCallback(async () => {
    const cacheKey = selectedLocation || "__all__";
    const cached = allAssetsCacheRef.current[cacheKey];
    if (cached) {
      setAllAssets(cached.rows);
      setUnallocatedCount(cached.unallocatedCount);
      return;
    }

    const locParam = selectedLocation ? `&location=${encodeURIComponent(selectedLocation)}` : "";
    const res = await fetch(`/api/assets?mode=all&pageSize=99999${locParam}`);
    if (res.ok) {
      const data = await res.json();
      const next = {
        rows: data.rows,
        unallocatedCount: data.rows.filter((r: Record<string, string>) => {
          const s = (r.Status || "").trim().toLowerCase();
          return s === "inventory - unallocated" || s === "unallocated";
        }).length,
      };
      allAssetsCacheRef.current[cacheKey] = next;
      setAllAssets(data.rows);
      setUnallocatedCount(next.unallocatedCount);
    }
  }, [selectedLocation]);

  const fetchCheckoutAssets = useCallback(async () => {
    const res = await fetch("/api/assets?mode=latest&pageSize=99999");
    if (res.ok) {
      const data = await res.json();
      const available = data.rows.filter((r: Record<string, string>) => {
        const s = (r.Status || "").trim().toLowerCase();
        const hasAssetId = (r["Asset ID"] || "").trim().length > 0;
        return hasAssetId && (s === "inventory - unallocated" || s === "unallocated");
      });
      setCheckoutAssets(available);
    }
  }, []);

  const prefetchReports = useCallback(async (location: string) => {
    const trimmed = location.trim();
    if (!trimmed || reportsCacheRef.current[trimmed]) return;
    try {
      const res = await fetch(`/api/reports?location=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const data = await res.json();
      reportsCacheRef.current[String(data.selectedLocation || trimmed)] = data;
    } catch { /* ignore */ }
  }, []);

  const fetchReports = useCallback(async (location: string) => {
    const trimmed = location.trim() || DEFAULT_LOCATION;
    const cached = reportsCacheRef.current[trimmed];
    if (cached) {
      setReports(cached);
      setReportsLoading(false);
      return;
    }

    setReportsLoading(true);
    try {
      const res = await fetch(`/api/reports?location=${encodeURIComponent(trimmed)}`);
      if (!res.ok) return;
      const data = await res.json();
      const resolvedLocation = String(data.selectedLocation || trimmed);
      reportsCacheRef.current[resolvedLocation] = data;
      setReports(data);

      const availableLocations = Array.isArray(data.availableLocations)
        ? (data.availableLocations as string[])
        : [];
      for (const loc of availableLocations) {
        if (loc !== resolvedLocation) void prefetchReports(loc);
      }

      if (resolvedLocation !== reportsLocation) {
        setReportsLocation(resolvedLocation);
      }
    } catch { /* ignore */ }
    setReportsLoading(false);
  }, [prefetchReports, reportsLocation]);

  useEffect(() => {
    if (tab === "Inventory") {
      fetchAssets(); fetchAllAssets();
      if (!locationsLoadedRef.current) {
        fetch("/api/assets?mode=locations").then(r => r.json()).then(d => {
          if (d.locations) {
            setAssetLocations(d.locations);
            locationsLoadedRef.current = true;
          }
        }).catch(() => {});
      }
    }
    if (tab === "Asset Log") fetchAllAssets();
    if (tab === "Check-In") fetchAllAssets();
    if (tab === "Check-Out") fetchCheckoutAssets();
    if (tab === "User Audit") {
      fetch("/api/audit").then(r => r.json()).then(d => setAuditRows(d.rows || [])).catch(() => {});
    }
  }, [tab, fetchAssets, fetchAllAssets, fetchCheckoutAssets]);

  useEffect(() => {
    if (tab !== "Reports") return;
    fetchReports(reportsLocation);
  }, [tab, reportsLocation, fetchReports]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    localStorage.setItem("ac_theme", next ? "dark" : "light");
  };

  const handleLogoutRef = useRef<(reason?: string) => Promise<void>>(null);
  const handleLogout = async (reason = "User Logout") => {
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    router.push("/");
  };
  handleLogoutRef.current = handleLogout;

  useEffect(() => {
    if (!user) return;
    const IDLE_MS = 10 * 60 * 1000;
    const WARN_MS = 30 * 1000;
    let idleTimer: ReturnType<typeof setTimeout>;
    let countdownInterval: ReturnType<typeof setInterval>;
    let warningActive = false;
    let lastActivity = Date.now();
    let warningStartedAt = 0;

    const doLogout = (reason: string) => handleLogoutRef.current?.(reason);

    const showWarning = () => {
      if (warningActive) return;
      warningActive = true;
      warningStartedAt = Date.now();
      setIdleWarning(true);
      let secs = Math.floor(WARN_MS / 1000);
      setIdleCountdown(secs);
      countdownInterval = setInterval(() => {
        secs--;
        setIdleCountdown(secs);
        if (secs <= 0) {
          clearInterval(countdownInterval);
          doLogout("Session Timeout");
        }
      }, 1000);
    };

    const resetIdle = () => {
      if (warningActive) return;
      lastActivity = Date.now();
      clearTimeout(idleTimer);
      clearInterval(countdownInterval);
      idleTimer = setTimeout(showWarning, IDLE_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (warningActive) {
        const warningElapsed = Date.now() - warningStartedAt;
        if (warningElapsed >= WARN_MS) {
          clearInterval(countdownInterval);
          doLogout("Session Timeout");
        } else {
          const remaining = Math.ceil((WARN_MS - warningElapsed) / 1000);
          setIdleCountdown(remaining);
        }
        return;
      }
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= IDLE_MS + WARN_MS) {
        doLogout("Session Timeout");
      } else if (elapsed >= IDLE_MS) {
        clearTimeout(idleTimer);
        showWarning();
      } else {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(showWarning, IDLE_MS - elapsed);
      }
    };

    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    const handler = () => { if (!warningActive) resetIdle(); };
    events.forEach((e) => window.addEventListener(e, handler, true));
    document.addEventListener("visibilitychange", onVisibilityChange);
    resetIdle();

    (window as unknown as Record<string, unknown>).__extendSession = () => {
      warningActive = false;
      warningStartedAt = 0;
      clearInterval(countdownInterval);
      setIdleWarning(false);
      setIdleCountdown(30);
      fetch("/api/auth/refresh", { method: "POST" })
        .then((res) => {
          if (!res.ok) doLogout("Session Expired");
          else resetIdle();
        })
        .catch(() => doLogout("Session Expired"));
    };

    return () => {
      clearTimeout(idleTimer);
      clearInterval(countdownInterval);
      events.forEach((e) => window.removeEventListener(e, handler, true));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      delete (window as unknown as Record<string, unknown>).__extendSession;
    };
  }, [user]);

  const autoFillFromAssets = useCallback((field: string, value: string) => {
    if (!value || value.length < 5 || !allAssets.length) return;
    const upper = value.toUpperCase().trim();
    const match = allAssets.find((a) =>
      (field === "Asset ID" && (a["Asset ID"] || "").toUpperCase().trim() === upper) ||
      (field === "Serial Number" && (a["Serial Number"] || "").toUpperCase().trim() === upper)
    );
    if (match) {
      setFormData((prev) => ({
        ...prev,
        "Asset ID": match["Asset ID"] || prev["Asset ID"] || "",
        "Serial Number": match["Serial Number"] || prev["Serial Number"] || "",
        Chip: match.Chip || prev.Chip || "",
        Configuration: match.Config || match.Configuration || prev.Configuration || "",
        "Asset Type": match["Asset Type"] || prev["Asset Type"] || "Laptop",
        Status: getStatusLabel(match.Status || prev.Status || "Working - Warranty"),
        "Assigned To": match["Current User"] || match["Assigned To"] || prev["Assigned To"] || "",
        Location: match.Location || prev.Location || "",
        Processor: match.Processor || prev.Processor || "",
        "Model Year": match["Model Year"] || match.Year || prev["Model Year"] || "",
        RAM: match.RAM || prev.RAM || "",
        Warranty: match.Warranty || prev.Warranty || "",
      }));
      setFlash({ type: "success", msg: `Auto-filled from existing asset: ${upper}` });
    }
  }, [allAssets]);

  const tabs: Tab[] = user?.role === "admin"
    ? ["Check-In", "Check-Out", "Inventory", "User Audit", "Asset Log", "Reports"]
    : user?.role === "editor"
      ? ["Check-In", "Check-Out", "Inventory"]
      : ["Inventory"];

  const clearAssetCaches = () => {
    reportsCacheRef.current = {};
    inventoryCacheRef.current = {};
    allAssetsCacheRef.current = {};
    checkoutAssetsCacheRef.current = {};
  };

  const handleCheckIn = async () => {
    setFormErrors({});
    const errors: Record<string, string> = {};
    if (!formData["Serial Number"]?.trim()) errors["Serial Number"] = "Serial Number is required";
    if (!formData.Chip?.trim()) errors.Chip = "Chip is required";
    if (!formData["Assigned To"]?.trim()) errors["Assigned To"] = "Assigned To is required";
    if (formData["Asset Type"] === "Other" && !formData["Custom Asset"]?.trim()) errors["Custom Asset"] = "Custom Asset Name is required";
    if (!formData.Status?.trim()) errors.Status = "Status is required";
    const aid = (formData["Asset ID"] || "").trim().toUpperCase();
    if (aid && !/^(02HW0|01HW0|34HW0|3HW0|4HW0)/.test(aid)) errors["Asset ID"] = "Must start with 02HW0, 01HW0, 34HW0, 3HW0, or 4HW0";
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    const submitData = { ...formData };
    if (submitData["Asset Type"] === "Other" && submitData["Custom Asset"]) {
      submitData["Asset Type"] = submitData["Custom Asset"];
    }
    delete submitData["Custom Asset"];
    setLoading(true);
    const res = await fetch("/api/assets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submitData),
    });
    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setFlash({ type: "success", msg: data.message });
      setFormData({});
      clearAssetCaches();
      fetchAssets();
      fetchAllAssets();
      fetchCheckoutAssets();
      setTimeout(() => { setTab("Check-Out"); fetchCheckoutAssets(); }, 1500);
    }
    else setFlash({ type: "error", msg: data.error });
  };

  const handleCheckOut = async () => {
    setFormErrors({});
    if (!selectedCheckout) { setFormErrors({ asset: "Please select an asset first" }); return; }
    if (!formData["Current User"]?.trim()) { setFormErrors({ "Current User": "Assigned To is required" }); return; }
    if (!formData["Current User"]?.trim()) { setFormErrors({ "Current User": "Required" }); return; }
    setLoading(true);
    const res = await fetch("/api/assets/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "Asset ID": selectedCheckout, "Current User": formData["Current User"], "Emp ID": formData["Emp ID"] || "" }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setFlash({ type: "success", msg: data.message });
      setFormData({});
      setSelectedCheckout("");
      setCheckoutSearch("");
      setCheckoutDropdownOpen(false);
      clearAssetCaches();
      fetchCheckoutAssets();
      fetchAllAssets();
      fetchAssets();
    }
    else setFlash({ type: "error", msg: data.error });
  };

  const handleEdit = async () => {
    if (!editAsset) return;
    setLoading(true);
    const res = await fetch("/api/assets/edit", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial: editAsset["Serial Number"], updates: formData }),
    });
    const data = await res.json();
    setLoading(false);
    if (data.success) {
      setFlash({ type: "success", msg: data.message });
      setEditAsset(null);
      setFormData({});
      clearAssetCaches();
      fetchAssets();
      fetchAllAssets();
    }
    else setFlash({ type: "error", msg: data.error });
  };

  const openEdit = (asset: Record<string, string>) => {
    setEditAsset(asset);
    setFormData({ ...asset });
  };

  const TAB_ICONS: Record<string, string> = {
    "Check-In": "📥",
    "Check-Out": "📤",
    "Inventory": "📦",
    "User Audit": "👥",
    "Asset Log": "💻",
    "Reports": "📋",
  };

  if (!user) return <div className="dash-loading"><div className="lp-spinner" style={{width:24,height:24,borderWidth:3}} /></div>;

  const totalPages = Math.ceil(totalAssets / pageSize);
  const assetLogRows = getSortedAssetLogRows(allAssets);
  const assetHeaders = Object.keys(allAssets[0] || assets[0] || {});
  const inventoryCols = showAllCols
    ? [
        ...DEFAULT_INVENTORY_COLS.filter((header) => assetHeaders.includes(header)),
        ...assetHeaders.filter((header) => !["Asset ID", "Serial Number", ...DEFAULT_INVENTORY_COLS].includes(header)),
      ]
    : DEFAULT_INVENTORY_COLS.filter((header) => assetHeaders.includes(header));
  const isUnallocated = (a: Record<string, string>) => {
    const s = (a.Status || "").trim().toLowerCase();
    return s === "inventory - unallocated" || s === "unallocated";
  };
  const filteredAssets = assets
    .filter((a) => hideUnavailable ? isUnallocated(a) : true)
    .sort((a, b) => {
      const aVal = isUnallocated(a) ? 0 : 1;
      const bVal = isUnallocated(b) ? 0 : 1;
      return aVal - bVal;
    });
  const isUnavailable = (a: Record<string, string>) => !isUnallocated(a);
  const editFields = Object.keys(editAsset || {}).filter((field) => !SYSTEM_ASSET_FIELDS.has(field) && !field.startsWith("Prev"));

  return (
    <div className="dash">
      {/* Top Bar */}
      <div className="dash-topbar">
        <span className="dash-welcome">Welcome, {user.name}</span>
        <button onClick={toggleTheme} className="dash-theme-btn">
          {dark ? "☀️ Light" : "🌙 Dark"}
        </button>
        <button onClick={() => handleLogout("User Logout")} className="dash-logout-btn">Log Out</button>
      </div>

      <div className="dash-body">
        {/* Sidebar */}
        <aside className="dash-sidebar">
          {tabs.map((t) => (
            <button
              key={t}
              className={`dash-nav-btn ${tab === t ? "active" : ""}`}
              onClick={() => { setTab(t); setPage(1); setSearch(""); setFlash(null); setCheckoutSearch(""); setSelectedCheckout(""); setCheckoutDropdownOpen(false); }}
              title={t}
            >
              <span className="dash-nav-icon">{TAB_ICONS[t] || "📄"}</span>
              <span className="dash-tooltip">{t}</span>
            </button>
          ))}
        </aside>

        {/* Main Content */}
        <main className="dash-content">
          {flash && (
            <div className={`alert alert-${flash.type} mb-4`}>
              {flash.msg}
              <button className="ml-4 font-bold" onClick={() => setFlash(null)}>×</button>
            </div>
          )}

          <div className="dash-card">

          {/* CHECK-IN */}
          {tab === "Check-In" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)" }}>
              <h2 className="text-xl font-bold mb-4">Check-In Asset</h2>
              <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                <div className="dash-form-layout">
                  <div className="dash-form-left">
                    <div className="dash-form-grid">
                      {["Asset ID", "Serial Number", "Chip", "Configuration", "Processor", "Model Year", "RAM", "Assigned To", "Location", "Emp ID", "Email"].map((field) => (
                        <div key={field} className="lp-field">
                          <input
                            className={`lp-float-input ${formData[field] ? "has-value" : ""} ${formErrors[field] ? "lp-input-err" : ""}`}
                            value={formData[field] || ""}
                            onChange={(e) => {
                              const val = field === "Emp ID" ? digitsOnly(e.target.value) : e.target.value;
                              setFormData((prev) => ({ ...prev, [field]: val }));
                              if ((field === "Asset ID" || field === "Serial Number") && val.length >= 5) autoFillFromAssets(field, val);
                            }}
                            onBlur={() => { if ((field === "Asset ID" || field === "Serial Number") && formData[field]) autoFillFromAssets(field, formData[field]); }}
                            inputMode={field === "Emp ID" ? "numeric" : undefined}
                            pattern={field === "Emp ID" ? "[0-9]*" : undefined}
                            maxLength={field === "Emp ID" ? 10 : undefined}
                            placeholder=" "
                          />
                          <label className="lp-float-label">{field} {["Serial Number", "Chip", "Assigned To"].includes(field) ? "*" : ""}</label>
                          {formErrors[field] && <p style={{ color: "#ff3b30", fontSize: 11, marginTop: 4, marginBottom: 2 }}>{formErrors[field]}</p>}
                        </div>
                      ))}
                      <div className="lp-field">
                        <select className="lp-float-input lp-select has-value" value={formData["Asset Type"] || "Laptop"} onChange={(e) => setFormData({ ...formData, "Asset Type": e.target.value })}>
                          {["Laptop", "Monitor", "Keyboard", "Mouse", "iPad", "Phone", "Other"].map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <label className="lp-float-label">Asset Type</label>
                      </div>
                      {formData["Asset Type"] === "Other" && (
                        <div className="lp-field">
                          <input className={`lp-float-input ${formData["Custom Asset"] ? "has-value" : ""} ${formErrors["Custom Asset"] ? "lp-input-err" : ""}`} value={formData["Custom Asset"] || ""} onChange={(e) => setFormData({ ...formData, "Custom Asset": e.target.value })} placeholder=" " />
                          <label className="lp-float-label">Custom Asset Name *</label>
                        </div>
                      )}
                      <div className="lp-field">
                        <select className={`lp-float-input lp-select ${formData.Status ? "has-value" : ""} ${formErrors.Status ? "lp-input-err" : ""}`} value={formData.Status || ""} onChange={(e) => setFormData({ ...formData, Status: e.target.value })}>
                          <option value="">Select Status</option>
                          {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                        <label className="lp-float-label">Status *</label>
                        {formErrors.Status && <p style={{ color: "#ff3b30", fontSize: 11, marginTop: 4 }}>{formErrors.Status}</p>}
                      </div>
                    </div>
                  </div>
                  <div className="dash-form-divider"><span>+</span></div>
                  <div className="dash-form-right">
                    <div className="dash-scan-title">Camera Scan</div>
                    <CameraScanner onScan={(r) => {
                      const updates: Record<string, string> = {};
                      if (r.assetId) updates["Asset ID"] = r.assetId;
                      if (r.serial) updates["Serial Number"] = r.serial;
                      setFormData((prev) => ({ ...prev, ...updates }));
                      const lookupId = r.assetId || r.serial;
                      if (lookupId && allAssets.length) {
                        const match = allAssets.find((a) => (r.assetId && a["Asset ID"] === r.assetId) || (r.serial && a["Serial Number"] === r.serial));
                        if (match) {
                          setFormData((prev) => ({ ...prev, ...updates, Chip: match.Chip || prev.Chip || "", Configuration: match.Config || match.Configuration || prev.Configuration || "", "Asset Type": match["Asset Type"] || prev["Asset Type"] || "Laptop", Status: getStatusLabel(match.Status || prev.Status || "Working - Warranty"), "Assigned To": match["Current User"] || match["Assigned To"] || prev["Assigned To"] || "", Location: match.Location || prev.Location || "", "Emp ID": match["Emp ID"] || prev["Emp ID"] || "", Email: match.Email || prev.Email || "", Processor: match.Processor || prev.Processor || "", "Model Year": match["Model Year"] || match.Year || prev["Model Year"] || "", RAM: match.RAM || prev.RAM || "", Warranty: match.Warranty || prev.Warranty || "" }));
                          setFlash({ type: "success", msg: `Found existing asset: ${r.assetId || r.serial}` });
                        } else { setFlash({ type: "info", msg: `New asset scanned: ${r.assetId || r.serial}` }); }
                      } else { setFlash({ type: "success", msg: `Scanned: ${r.assetId || ""} ${r.serial || ""}`.trim() }); }
                    }} />
                    <p className="dash-scan-help">Opens the camera and reads the white sticker <strong>Asset ID</strong> starting with <strong>02HW0XXXXX</strong>. If no sticker, it finds <strong>Serial Number</strong> (5-15 alphanumeric, e.g. <strong>M9HWCPJWVR</strong>). <strong>Result:</strong> auto-fills details when found, otherwise marks as new asset.</p>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, padding: "12px 0 0", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
                <button className="btn-primary" onClick={handleCheckIn} disabled={loading}>{loading ? "Saving..." : "Confirm Check-In"}</button>
                <button className="btn-secondary" onClick={() => setFormData({})}>Clear</button>
              </div>
            </div>
          )}

          {/* CHECK-OUT */}
          {tab === "Check-Out" && (
            <div>
              <h2 className="text-xl font-bold mb-4">Check-Out Asset</h2>
              <div className="dash-form-layout">
                <div className="dash-form-left">
              <div style={{ marginBottom: 12, padding: 2 }}>
                <div className="lp-field checkout-combo" style={{ position: "relative" }}>
                  <input
                    className={`lp-float-input ${(checkoutSearch || selectedCheckout) ? "has-value" : ""}`}
                    value={checkoutSearch || (selectedCheckout ? `${selectedCheckout}` : "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCheckoutSearch(val);
                      if (!val) { setSelectedCheckout(""); setCheckoutDropdownOpen(false); return; }
                      clearTimeout((window as unknown as Record<string,number>).__coDebounce);
                      (window as unknown as Record<string,number>).__coDebounce = window.setTimeout(() => setCheckoutDropdownOpen(true), 300);
                    }}
                    onFocus={() => { setCheckoutDropdownOpen(true); if (!checkoutAssets.length) fetchCheckoutAssets(); }}                    placeholder=" "
                    autoComplete="off"
                  />
                  <label className="lp-float-label">Select Asset (type to search)</label>
                  {checkoutDropdownOpen && (
                    <div style={{ position: "absolute", top: "100%", left: 0, right: 0, maxHeight: 200, overflowY: "auto", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 20, marginTop: 4 }}>
                      {checkoutAssets.filter(a => {
                        const q = (checkoutSearch || "").trim();
                        if (!q || q.length < 3) return true;
                        const qLower = q.toLowerCase();
                        const aid = (a["Asset ID"] || "");
                        const serial = (a["Serial Number"] || "");
                        const aidLower = aid.toLowerCase();
                        const serialLower = serial.toLowerCase();
                        const last5 = aid.slice(-5);
                        if (aidLower === qLower || aid === q) return true;
                        if (serialLower.includes(qLower)) return true;
                        if (last5 === q) return true;
                        if (q.length >= 5 && aidLower.endsWith(qLower)) return true;
                        if (q.length >= 5 && aidLower.includes(qLower)) return true;
                        if (q.length < 5) return last5.startsWith(q) || aidLower.startsWith(qLower);
                        return false;
                      }).map(a => (
                        <div key={a["Asset ID"]}
                          style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid var(--border)", transition: "background 0.1s" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,122,255,0.06)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          onClick={() => {
                            setSelectedCheckout(a["Asset ID"]);
                            setCheckoutSearch(a["Asset ID"]);
                            setCheckoutDropdownOpen(false);
                          }}
                        >
                          <strong>{a["Asset ID"]}</strong> — {a.Configuration || a.Config} <span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(a.Status)] || "#8e8e93", color: "#fff", fontSize: 10 }}>{getStatusLabel(a.Status)}</span>
                        </div>
                      ))}
                      {checkoutAssets.filter(a => {
                        const q = (checkoutSearch || "").trim();
                        if (!q || q.length < 3) return true;
                        const aid = (a["Asset ID"] || "");
                        const last5 = aid.slice(-5);
                        if (aid.toLowerCase() === q.toLowerCase() || last5 === q) return true;
                        if (q.length >= 5 && aid.toLowerCase().endsWith(q.toLowerCase())) return true;
                        if (q.length >= 5 && aid.toLowerCase().includes(q.toLowerCase())) return true;
                        if (q.length < 5) return last5.startsWith(q) || aid.toLowerCase().startsWith(q.toLowerCase());
                        return false;
                      }).length === 0 && <div style={{ padding: "12px", color: "var(--text-secondary)", textAlign: "center", fontSize: 13 }}>{checkoutAssets.length === 0 ? "Loading assets..." : "No matching assets"}</div>}
                    </div>
                  )}
                  {formErrors.asset && <p style={{ color: "#ff3b30", fontSize: 12, marginTop: 4, fontWeight: 600 }}>{formErrors.asset}</p>}
                </div>
              </div>
              {selectedCheckout && (() => {
                const asset = checkoutAssets.find((a) => a["Asset ID"] === selectedCheckout);
                return asset ? (
                  <div className="alert alert-info" style={{ marginBottom: 12 }}>
                    <strong>Type:</strong> {asset["Asset Type"]} | <strong>Config:</strong> {asset.Configuration || asset.Config} | <strong>Status:</strong> <span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(asset.Status)] || "#8e8e93", color: "#fff" }}>{getStatusLabel(asset.Status)}</span>
                  </div>
                ) : null;
              })()}
              <div className="dash-form-grid">
                <div className="lp-field">
                  <input className={`lp-float-input ${formData["Current User"] ? "has-value" : ""} ${formErrors["Current User"] ? "lp-input-err" : ""}`} value={formData["Current User"] || ""} onChange={(e) => setFormData({ ...formData, "Current User": e.target.value })} placeholder=" " />
                  <label className="lp-float-label">Assigned To *</label>
                </div>
                <div className="lp-field">
                  <input
                    className={`lp-float-input ${formData["Emp ID"] ? "has-value" : ""}`}
                    value={formData["Emp ID"] || ""}
                    onChange={(e) => setFormData({ ...formData, "Emp ID": digitsOnly(e.target.value) })}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={10}
                    placeholder=" "
                  />
                  <label className="lp-float-label">Emp ID</label>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <button className="btn-primary" onClick={handleCheckOut} disabled={loading}>{loading ? "Processing..." : "Confirm Check-Out"}</button>
              </div>
                </div>
                <div className="dash-form-divider"><span>+</span></div>
                <div className="dash-form-right">
                  <div className="dash-scan-title">Camera Scan</div>
                  <CameraScanner assetOnly onScan={(r) => {
                    if (r.assetId) {
                      const match = checkoutAssets.find((a) => a["Asset ID"] === r.assetId);
                      if (match) { setSelectedCheckout(r.assetId); setFlash({ type: "success", msg: `Scanned: ${r.assetId}` }); }
                      else setFlash({ type: "error", msg: `Asset ${r.assetId} not found in available assets` });
                    }
                  }} />
                  <p className="dash-scan-help">Opens the camera and reads the white sticker <strong>Asset ID</strong> starting with <strong>02HW0XXXXX</strong>. <strong>Result:</strong> selects the asset and auto-fills Assigned To and Status.</p>
                </div>
              </div>
            </div>
          )}

          {/* INVENTORY */}
          {tab === "Inventory" && !fullscreen && (
            <div className={fullscreen ? "inv-fullscreen" : ""}>
              <div className="inv-header">
                <h2 className="text-xl font-bold">Inventory</h2>
                <div className="inv-total-badge">{allAssets.length || totalAssets} <span>Assets</span></div>
                <div className="inv-total-badge" style={{ background: "linear-gradient(135deg, #ff9500, #ff6b00)" }}>{unallocatedCount} <span>Available</span></div>
                {assetLocations.length > 1 && (
                  <select value={selectedLocation} onChange={(e) => { setSelectedLocation(e.target.value); setPage(1); }} style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>
                    {assetLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                  </select>
                )}
                <div style={{ flex: 1 }} />
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13 }}>
                  {[10, 25, 50, 100, 200].map(n => <option key={n} value={n}>{n} rows</option>)}
                </select>
                <GearMenu id="inv" data={allAssets.length ? allAssets : assets} filename="inventory.xlsx" />
              </div>
              {(() => {
                return unallocatedCount <= 10 && unallocatedCount > 0 ? (
                  <div className="alert alert-warning" style={{ fontWeight: 600, marginBottom: 12 }}>
                    Inventory Low: {unallocatedCount} unallocated assets remaining (threshold: 10)
                  </div>
                ) : null;
              })()}
              <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input className="form-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 32 }} placeholder="Search assets..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                  {search && <button onClick={() => { setSearch(""); setPage(1); fetchAssets(); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-secondary)" }}>✕</button>}
                </div>
              </div>
              {locationLoading && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40, gap: 10 }}>
                  <div className="lp-spinner" style={{ width: 20, height: 20, borderWidth: 2, borderTopColor: "var(--accent)" }} />
                  <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>Loading {selectedLocation || "all"} assets...</span>
                </div>
              )}
              {!locationLoading && (
                <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", maxHeight: "calc(100vh - 310px)" }}>
                  {/* LEFT PINNED: Asset ID */}
                  <div className="inv-split-left" onScroll={(e) => {
                    const t = e.currentTarget.scrollTop;
                    const mid = document.getElementById("inv-split-mid");
                    const right = document.getElementById("inv-split-right");
                    if (mid) mid.scrollTop = t;
                    if (right) right.scrollTop = t;
                  }}>
                    <table className="data-table"><thead><tr><th style={{ minWidth: 110 }}>Asset ID</th></tr></thead>
                      <tbody>{filteredAssets.map((a, i) => (
                        <tr key={i} style={isUnavailable(a) ? { background: "rgba(255,149,0,0.04)" } : { background: "rgba(52,199,89,0.04)" }}>
                          <td style={{ fontWeight: 600, whiteSpace: "nowrap", borderLeft: isUnavailable(a) ? "3px solid #ff9500" : "3px solid #34c759" }}>{a["Asset ID"]}</td>
                        </tr>
                      ))}{filteredAssets.length === 0 && <tr><td style={{textAlign:"center",padding:20}}>—</td></tr>}</tbody>
                    </table>
                  </div>
                  {/* MIDDLE SCROLLABLE */}
                  <div id="inv-split-mid" className="inv-split-mid" onScroll={(e) => {
                    const t = e.currentTarget.scrollTop;
                    const left = e.currentTarget.previousElementSibling as HTMLElement;
                    const right = document.getElementById("inv-split-right");
                    if (left) left.scrollTop = t;
                    if (right) right.scrollTop = t;
                  }}>
                    <table className="data-table" style={{ minWidth: inventoryCols.length * 120 }}>
                      <thead><tr><th>Serial Number</th>{inventoryCols.map(h => <th key={h} style={{whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
                      <tbody>{filteredAssets.map((a, i) => (
                        <tr key={i} style={isUnavailable(a) ? { background: "rgba(255,149,0,0.04)" } : { background: "rgba(52,199,89,0.04)" }}>
                          <td style={{whiteSpace:"nowrap"}}>{a["Serial Number"] || ""}</td>
                          {inventoryCols.map(h => (
                            <td key={h} style={{whiteSpace:"nowrap"}}>
                              {h === "Status" ? <span className="status-badge" style={{background: STATUS_COLORS[getStatusLabel(a[h])] || "#8e8e93", color:"#fff"}}>{getStatusLabel(a[h])}</span> : (a[h] || "")}
                            </td>
                          ))}
                        </tr>
                      ))}{filteredAssets.length === 0 && <tr><td colSpan={inventoryCols.length+1} style={{textAlign:"center",padding:20,color:"var(--text-secondary)"}}>No assets found</td></tr>}</tbody>
                    </table>
                  </div>
                  {/* RIGHT PINNED: Edit */}
                  {user.role !== "viewer" && (
                    <div id="inv-split-right" className="inv-split-right" onScroll={(e) => {
                      const t = e.currentTarget.scrollTop;
                      const mid = document.getElementById("inv-split-mid");
                      const left = mid?.previousElementSibling as HTMLElement;
                      if (mid) mid.scrollTop = t;
                      if (left) left.scrollTop = t;
                    }}>
                      <table className="data-table"><thead><tr><th>Edit</th></tr></thead>
                        <tbody>{filteredAssets.map((a, i) => (
                          <tr key={i} style={isUnavailable(a) ? { background: "rgba(255,149,0,0.04)" } : { background: "rgba(52,199,89,0.04)" }}>
                            <td><button style={{color:"var(--accent)",fontWeight:600,fontSize:13,background:"none",border:"none",cursor:"pointer"}} onClick={() => openEdit(a)}>Edit</button></td>
                          </tr>
                        ))}{filteredAssets.length === 0 && <tr><td>—</td></tr>}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              {totalPages > 1 && (
                <div className="pagination mt-2">
                  <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", padding: "0 8px" }}>Page {page} of {totalPages}</span>
                  <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </div>
          )}

          {/* USER AUDIT */}
          {tab === "User Audit" && (
            <div>
              <div className="inv-header">
                <h2 className="text-xl font-bold">User Audit</h2>
                <div className="inv-total-badge">{auditRows.length} <span>Records</span></div>
                <div style={{ flex: 1 }} />
                <select value={auditPageSize} onChange={(e) => { setAuditPageSize(Number(e.target.value)); setAuditPage(1); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13 }}>
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} rows</option>)}
                </select>
                <GearMenu id="audit" data={auditRows} filename="user_audit.xlsx" />
              </div>
              <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input className="form-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 32 }} placeholder="Search audit..." value={auditSearch} onChange={(e) => { setAuditSearch(e.target.value); setAuditPage(1); }} />
                  {auditSearch && <button onClick={() => { setAuditSearch(""); setAuditPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-secondary)" }}>✕</button>}
                </div>
              </div>
              {(() => {
                const filtered = auditSearch ? auditRows.filter(r => Object.values(r).some(v => (v || "").toLowerCase().includes(auditSearch.toLowerCase()))) : auditRows;
                const paged = filtered.slice((auditPage - 1) * auditPageSize, auditPage * auditPageSize);
                const auditCols = ["Login Time", "Logout Time", "Duration", "Logout Method", "Login Failure", "Device"];
                const syncAudit = (src: string) => {
                  const l = document.getElementById("aud-left"); const m = document.getElementById("aud-mid");
                  const source = src === "left" ? l : m;
                  if (!source) return;
                  [l, m].forEach(el => { if (el && el !== source) el.scrollTop = source.scrollTop; });
                };
                const auditTotalPages = Math.ceil(filtered.length / auditPageSize);
                return (
                  <>
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    <div id="aud-left" className="inv-split-left" onScroll={() => syncAudit("left")} style={{ flexShrink: 0, overflowY: "auto", overflowX: "hidden", maxHeight: "calc(100vh - 310px)", borderRight: "2px solid var(--border)", scrollbarWidth: "none" }}>
                      <table className="data-table" style={{ minWidth: 200 }}>
                        <thead><tr><th style={{ minWidth: 90 }}>Emp ID</th><th style={{ minWidth: 110 }}>Name</th></tr></thead>
                        <tbody>{paged.map((r, i) => <tr key={i} style={r["Login Failure"] ? { background: "rgba(255,59,48,0.04)" } : {}}><td>{r["Emp ID"]}</td><td style={{ fontWeight: 600 }}>{r.Name}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div id="aud-mid" className="inv-split-mid" onScroll={() => syncAudit("mid")} style={{ flex: 1, overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 310px)" }}>
                      <table className="data-table" style={{ minWidth: auditCols.length * 130 }}>
                        <thead><tr>{auditCols.map(h => <th key={h} style={{ whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                        <tbody>{paged.map((r, i) => (
                          <tr key={i} style={r["Login Failure"] ? { background: "rgba(255,59,48,0.04)" } : {}}>
                            <td>{r["Login Time"]}</td><td>{r["Logout Time"]}</td>
                            <td>{r["Total Minutes"] ? `${r["Total Minutes"]}m` : "-"}</td>
                            <td style={r["Logout Method"]?.includes("Incorrect") || r["Logout Method"]?.includes("Invalid") ? { color: "#ff3b30", fontWeight: 600 } : {}}>{r["Logout Method"]}</td>
                            <td style={r["Login Failure"] ? { color: "#ff3b30", fontWeight: 600 } : { color: "#34c759" }}>{r["Login Failure"] || "-"}</td>
                            <td>{r["Logged In Device"]}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                  {auditTotalPages > 1 && (
                    <div className="pagination mt-2">
                      <button className="page-btn" disabled={auditPage <= 1} onClick={() => setAuditPage(auditPage - 1)}>Prev</button>
                      <span style={{ fontSize: 13, color: "var(--text-secondary)", padding: "0 8px" }}>Page {auditPage} of {auditTotalPages}</span>
                      <button className="page-btn" disabled={auditPage >= auditTotalPages} onClick={() => setAuditPage(auditPage + 1)}>Next</button>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>
          )}

          {/* ASSET LOG */}
          {tab === "Asset Log" && (
            <div>
              <div className="inv-header">
                <h2 className="text-xl font-bold">Asset Log</h2>
                <div className="inv-total-badge">{assetLogRows.length} <span>Records</span></div>
                <div style={{ flex: 1 }} />
                <select value={logPageSize} onChange={(e) => { setLogPageSize(Number(e.target.value)); setLogPage(1); }} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13 }}>
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} rows</option>)}
                </select>
                <GearMenu id="log" data={assetLogRows} filename="asset_log.xlsx" />
              </div>
              <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ position: "relative", flex: 1 }}>
                  <input className="form-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 32 }} placeholder="Search logs..." value={logSearch} onChange={(e) => { setLogSearch(e.target.value); setLogPage(1); }} />
                  {logSearch && <button onClick={() => { setLogSearch(""); setLogPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-secondary)" }}>✕</button>}
                </div>
              </div>
              {(() => {
                const filtered = logSearch ? assetLogRows.filter(r => Object.values(r).some(v => (v || "").toLowerCase().includes(logSearch.toLowerCase()))) : assetLogRows;
                const paged = filtered.slice((logPage - 1) * logPageSize, logPage * logPageSize);
                const logCols = ["Serial Number", "Action By", "Reason", "Status", "Current User", "Date"];
                const syncLog = (src: string) => {
                  const l = document.getElementById("log-left"); const m = document.getElementById("log-mid");
                  const source = src === "left" ? l : m;
                  if (!source) return;
                  [l, m].forEach(el => { if (el && el !== source) el.scrollTop = source.scrollTop; });
                };
                const logTotalPages = Math.ceil(filtered.length / logPageSize);
                return (
                  <>
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                    <div id="log-left" className="inv-split-left" onScroll={() => syncLog("left")} style={{ flexShrink: 0, overflowY: "auto", overflowX: "hidden", maxHeight: "calc(100vh - 310px)", borderRight: "2px solid var(--border)", scrollbarWidth: "none" }}>
                      <table className="data-table" style={{ minWidth: 120 }}>
                        <thead><tr><th style={{ minWidth: 120 }}>Asset ID</th></tr></thead>
                        <tbody>{paged.map((r, i) => <tr key={i}><td style={{ fontWeight: 600 }}>{r["Asset ID"]}</td></tr>)}</tbody>
                      </table>
                    </div>
                    <div id="log-mid" className="inv-split-mid" onScroll={() => syncLog("mid")} style={{ flex: 1, overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 310px)" }}>
                      <table className="data-table" style={{ minWidth: logCols.length * 130 }}>
                        <thead><tr>{logCols.map(h => <th key={h} style={{ whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
                        <tbody>{paged.map((r, i) => (
                          <tr key={i}>
                            <td>{r["Serial Number"]}</td><td>{r["Action By"]}</td><td>{r.Reason}</td>
                            <td><span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(r.Status)] || "#8e8e93", color: "#fff" }}>{getStatusLabel(r.Status)}</span></td>
                            <td>{r["Current User"]}</td><td>{r.Date}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                  {logTotalPages > 1 && (
                    <div className="pagination mt-2">
                      <button className="page-btn" disabled={logPage <= 1} onClick={() => setLogPage(logPage - 1)}>Prev</button>
                      <span style={{ fontSize: 13, color: "var(--text-secondary)", padding: "0 8px" }}>Page {logPage} of {logTotalPages}</span>
                      <button className="page-btn" disabled={logPage >= logTotalPages} onClick={() => setLogPage(logPage + 1)}>Next</button>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>
          )}

          {/* REPORTS */}
          {tab === "Reports" && reportsLoading && !reports && (
            <div className="alert alert-info">Loading reports...</div>
          )}
          {tab === "Reports" && reports && (
            <div>
              {(() => {
                const availableReportLocations = ((reports.availableLocations as string[]) || assetLocations);
                const showReportsLocationControls = availableReportLocations.length > 1;
                return (
                  <>
              <div style={{ textAlign: "center", marginBottom: 20 }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Leadership Reports</h2>
                <p style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 4 }}>Real-time asset analytics by site</p>
              </div>
              {showReportsLocationControls && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Statistics Site</span>
                  <select
                    value={reportsLocation}
                    onChange={(e) => setReportsLocation(e.target.value)}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}
                  >
                    {availableReportLocations.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                  {reportsLoading && <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Loading {reportsLocation}...</span>}
                </div>
              )}
              {(() => {
                const locs = (reports.sheetLocations || {}) as Record<string, number>;
                const locEntries = Object.entries(locs);
                if (locEntries.length <= 1) return null;
                const total = locEntries.reduce((sum, [, c]) => sum + c, 0);
                const selectedLoc = String(reports.selectedLocation || reportsLocation);
                const selectedCount = locs[selectedLoc] || 0;
                return (
                  <div style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Assets by Location</h3>
                    <div className="rpt-metrics-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                      <div className="rpt-metric-card" style={{ borderTop: "3px solid #007aff" }}>
                        <div className="rpt-metric-icon">🌍</div>
                        <div className="rpt-metric-value" style={{ color: "#007aff" }}>{total}</div>
                        <div className="rpt-metric-label">All Locations</div>
                      </div>
                      <div className="rpt-metric-card" style={{ borderTop: "3px solid #34c759" }}>
                        <div className="rpt-metric-icon">{selectedLoc === "Austin" ? "🏢" : "🏬"}</div>
                        <div className="rpt-metric-value" style={{ color: "#34c759" }}>{selectedCount}</div>
                        <div className="rpt-metric-label">{selectedLoc} Assets</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="rpt-metrics-grid">
                {[
                  { label: "Total Assets", value: (reports.overview as Record<string, number>).total, color: "#5e5ce6", icon: "🧾" },
                  { label: "Assigned", value: (reports.overview as Record<string, number>).inUse, color: "#34c759", icon: "💻" },
                  { label: "Unallocated", value: (reports.overview as Record<string, number>).available, color: "#ff9500", icon: "📦" },
                  { label: "On Loan", value: (reports.overview as Record<string, number>).loaner, color: "#007aff", icon: "🔄" },
                  { label: "In Repair", value: (reports.overview as Record<string, number>).repair, color: "#ff3b30", icon: "🔧" },
                  { label: "Broken - Send to Edison", value: (reports.overview as Record<string, number>).brokenEdison, color: "#ff2d55", icon: "📦" },
                  { label: "Sent to Edison", value: (reports.overview as Record<string, number>).sentEdison, color: "#8e8e93", icon: "📤" },
                  { label: "M-Chip Assets", value: (reports.mChipCount as number) || 0, color: "#5856d6", icon: "⚡" },
                  { label: "Intel Assets", value: (reports.intelChipCount as number) || 0, color: "#007aff", icon: "🔲" },
                ].map((m) => (
                  <div key={m.label} className="rpt-metric-card" style={{ borderTop: `3px solid ${m.color}` }}>
                    <div className="rpt-metric-icon">{m.icon}</div>
                    <div className="rpt-metric-value" style={{ color: m.color }}>{m.value}</div>
                    <div className="rpt-metric-label">{m.label}</div>
                  </div>
                ))}
              </div>
                  </>
                );
              })()}
              <div className="tab-bar">
                {[
                  { key: "status", label: "Status" },
                  { key: "year", label: "By Year" },
                  { key: "type", label: "Type & Processor" },
                  { key: "users", label: "User Analytics" },
                  { key: "activity", label: "Activity" },
                ].map((t) => (
                  <div key={t.key} className={`tab-item ${reportsTab === t.key ? "active" : ""}`} onClick={() => setReportsTab(t.key)}>{t.label}</div>
                ))}
              </div>
              {reportsTab === "status" && (
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table className="data-table">
                    <thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
                    <tbody>
                      {Object.entries(reports.statusBreakdown as Record<string, number>).sort(([, a], [, b]) => b - a).map(([status, count]) => (
                        <tr key={status}>
                          <td><span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(status)] || "#8e8e93", color: "#fff" }}>{getStatusLabel(status)}</span></td>
                          <td className="font-semibold">{count}</td>
                          <td>{((count / Math.max((reports.overview as Record<string, number>).current || 0, 1)) * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {reportsTab === "year" && (
                <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                  <table className="data-table">
                    <thead><tr><th>Year</th><th>Total</th><th>Assigned</th><th>Unallocated</th><th>Loaner</th><th>Repair</th><th>Broken-Edison</th><th>Sent-Edison</th><th>Special</th><th>Other</th></tr></thead>
                    <tbody>
                      {Object.entries(reports.byYear as Record<string, Record<string, number>>).sort(([a], [b]) => b.localeCompare(a)).map(([year, data]) => (
                        <tr key={year}>
                          <td className="font-bold">{year}</td>
                          <td className="font-semibold">{data.total}</td>
                          <td>{data.inUse}</td><td>{data.available}</td><td>{data.loaner}</td>
                          <td>{data.repair}</td><td>{data.brokenEdison || 0}</td><td>{data.sentEdison || 0}</td><td>{data.special}</td><td>{data.other || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {reportsTab === "type" && (
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold mb-2">By Asset Type</h3>
                    <table className="data-table"><thead><tr><th>Type</th><th>Count</th></tr></thead>
                      <tbody>{Object.entries(reports.byType as Record<string, number>).sort(([, a], [, b]) => b - a).map(([t, c]) => <tr key={t}><td className="font-semibold">{t}</td><td>{c}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">By Processor</h3>
                    <table className="data-table"><thead><tr><th>Processor</th><th>Count</th></tr></thead>
                      <tbody>{Object.entries(reports.byProcessor as Record<string, number>).sort(([, a], [, b]) => b - a).map(([p, c]) => <tr key={p}><td className="font-semibold">{p}</td><td>{c}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}
              {reportsTab === "users" && (
                <div>
                  <h3 className="font-semibold mb-2">Most Assigned-To Users (Top 15)</h3>
                  <table className="data-table"><thead><tr><th>#</th><th>User</th><th>Assets Held</th></tr></thead>
                    <tbody>{(reports.topAssigned as [string, number][]).map(([u, c], i) => <tr key={u}><td>{i + 1}</td><td className="font-semibold">{u}</td><td>{c}</td></tr>)}</tbody>
                  </table>
                  <h3 className="font-semibold mt-6 mb-2">Check-Outs by User</h3>
                  <table className="data-table"><thead><tr><th>#</th><th>User</th><th>Count</th></tr></thead>
                    <tbody>{(reports.checkoutsByUser as [string, number][]).map(([u, c], i) => <tr key={u}><td>{i + 1}</td><td className="font-semibold">{u}</td><td>{c}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {reportsTab === "activity" && (
                <div>
                  <div className="rpt-metrics-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 16 }}>
                    <div className="rpt-metric-card" style={{ borderTop: "3px solid #34c759" }}><div className="rpt-metric-icon">📥</div><div className="rpt-metric-value" style={{ color: "#34c759" }}>{(reports.recentActivity as Record<string, number>).checkIns}</div><div className="rpt-metric-label">Check-Ins (30d)</div></div>
                    <div className="rpt-metric-card" style={{ borderTop: "3px solid #007aff" }}><div className="rpt-metric-icon">📤</div><div className="rpt-metric-value" style={{ color: "#007aff" }}>{(reports.recentActivity as Record<string, number>).checkOuts}</div><div className="rpt-metric-label">Check-Outs (30d)</div></div>
                    <div className="rpt-metric-card" style={{ borderTop: "3px solid #ff9500" }}><div className="rpt-metric-icon">✏️</div><div className="rpt-metric-value" style={{ color: "#ff9500" }}>{(reports.recentActivity as Record<string, number>).edits}</div><div className="rpt-metric-label">Edits (30d)</div></div>
                  </div>
                  <h3 className="font-semibold mb-2">Most Checked-Out Assets</h3>
                  <table className="data-table"><thead><tr><th>#</th><th>Asset ID</th><th>Count</th></tr></thead>
                    <tbody>{(reports.topCheckedOut as [string, number][]).map(([a, c], i) => <tr key={a}><td>{i + 1}</td><td className="font-semibold">{a}</td><td>{c}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

      {/* Fullscreen Inventory — rendered outside dash-card */}
      {tab === "Inventory" && fullscreen === "inv" && (
        <div className="inv-fullscreen">
          <div className="inv-header">
            <h2 className="text-xl font-bold">Inventory (Fullscreen)</h2>
            <div className="inv-total-badge">{allAssets.length || totalAssets} <span>Assets</span></div>
            <div style={{ flex: 1 }} />
            <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setFullscreen("")}>✕ Exit Fullscreen</button>
          </div>
          <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <input className="form-input" style={{ width: "100%", boxSizing: "border-box", paddingRight: 32 }} placeholder="Search assets..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
              {search && <button onClick={() => { setSearch(""); setPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "var(--text-secondary)" }}>✕</button>}
            </div>
          </div>
          <div className="inv-table-wrap" style={{ maxHeight: "calc(100vh - 160px)" }}>
            <table className="data-table inv-table">
              <thead><tr>
                <th className="inv-pin-left">Asset ID</th>
                <th className="inv-col-serial">Serial Number</th>
                {inventoryCols.map((h) => <th key={h}>{h}</th>)}
                {user.role !== "viewer" && <th className="inv-pin-right">Edit</th>}
              </tr></thead>
              <tbody>
                {filteredAssets.map((a, i) => (
                  <tr key={i}>
                    <td className="inv-pin-left font-semibold">{a["Asset ID"]}</td>
                    <td className="inv-col-serial">{a["Serial Number"] || ""}</td>
                    {inventoryCols.map((h) => (
                      <td key={h}>{h === "Status" ? <span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(a[h])] || "#8e8e93", color: "#fff" }}>{getStatusLabel(a[h])}</span> : (a[h] || "")}</td>
                    ))}
                    {user.role !== "viewer" && <td className="inv-pin-right"><button style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, background: "none", border: "none", cursor: "pointer" }} onClick={() => openEdit(a)}>Edit</button></td>}
                  </tr>
                ))}
                {filteredAssets.length === 0 && (
                  <tr>
                    <td colSpan={inventoryCols.length + (user.role !== "viewer" ? 3 : 2)} style={{ textAlign: "center", padding: 24, color: "var(--text-secondary)" }}>
                      No assets found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="pagination mt-2">
              <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
              <span style={{ fontSize: 13, color: "var(--text-secondary)", padding: "0 8px" }}>Page {page} of {totalPages}</span>
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen User Audit */}
      {fullscreen === "audit" && (
        <div className="inv-fullscreen">
          <div className="inv-header">
            <h2 className="text-xl font-bold">User Audit (Fullscreen)</h2>
            <div className="inv-total-badge">{auditRows.length} <span>Records</span></div>
            <div style={{ flex: 1 }} />
            <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setFullscreen("")}>✕ Exit Fullscreen</button>
          </div>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 120px)" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead><tr>{["Emp ID", "Name", "Login Time", "Logout Time", "Duration", "Logout Method", "Login Failure", "Device"].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{auditRows.map((r, i) => (
                <tr key={i} style={r["Login Failure"] ? { background: "rgba(255,59,48,0.04)" } : {}}>
                  <td>{r["Emp ID"]}</td><td style={{ fontWeight: 600 }}>{r.Name}</td><td>{r["Login Time"]}</td><td>{r["Logout Time"]}</td>
                  <td>{r["Total Minutes"] ? `${r["Total Minutes"]}m` : "-"}</td>
                  <td>{r["Logout Method"]}</td>
                  <td style={r["Login Failure"] ? { color: "#ff3b30", fontWeight: 600 } : { color: "#34c759" }}>{r["Login Failure"] || "-"}</td>
                  <td>{r["Logged In Device"]}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fullscreen Asset Log */}
      {fullscreen === "log" && (
        <div className="inv-fullscreen">
          <div className="inv-header">
            <h2 className="text-xl font-bold">Asset Log (Fullscreen)</h2>
            <div className="inv-total-badge">{assetLogRows.length} <span>Records</span></div>
            <div style={{ flex: 1 }} />
            <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={() => setFullscreen("")}>✕ Exit Fullscreen</button>
          </div>
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 120px)" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead><tr>{["Asset ID", "Serial Number", "Action By", "Reason", "Status", "Current User", "Date"].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>{assetLogRows.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r["Asset ID"]}</td><td>{r["Serial Number"]}</td><td>{r["Action By"]}</td><td>{r.Reason}</td>
                  <td><span className="status-badge" style={{ background: STATUS_COLORS[getStatusLabel(r.Status)] || "#8e8e93", color: "#fff" }}>{getStatusLabel(r.Status)}</span></td>
                  <td>{r["Current User"]}</td><td>{r.Date}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {editAsset && (
        <div className="modal-overlay" onClick={() => setEditAsset(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Edit Asset — {editAsset["Serial Number"]}</h2>
            <div className="dash-form-grid">
              {editFields.map((field) => (
                <div key={field} className="lp-field">
                  <input
                    className={`lp-float-input ${formData[field] ? "has-value" : ""}`}
                    value={formData[field] || ""}
                    onChange={(e) => setFormData({ ...formData, [field]: field === "Emp ID" ? digitsOnly(e.target.value) : e.target.value })}
                    inputMode={field === "Emp ID" ? "numeric" : undefined}
                    pattern={field === "Emp ID" ? "[0-9]*" : undefined}
                    maxLength={field === "Emp ID" ? 10 : undefined}
                    placeholder=" "
                  />
                  <label className="lp-float-label">{field}</label>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn-primary" onClick={handleEdit} disabled={loading}>{loading ? "Saving..." : "Save Changes"}</button>
              <button className="btn-secondary" onClick={() => { setEditAsset(null); setFormData({}); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      </main>

      {idleWarning && (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
          <div style={{ background: "var(--bg-card)", borderRadius: 20, padding: "32px 28px", maxWidth: 380, width: "90%", textAlign: "center", boxShadow: "0 16px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⏱️</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: "var(--text-primary)" }}>Session Expiring Soon</h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 16 }}>You have been inactive. Your session will end in:</p>
            <div style={{ fontSize: 48, fontWeight: 800, color: idleCountdown <= 10 ? "#ff3b30" : "var(--accent)", marginBottom: 24, lineHeight: 1 }}>
              {idleCountdown}<span style={{ fontSize: 18, fontWeight: 600 }}>s</span>
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn-primary" style={{ flex: 1, padding: "12px 20px" }} onClick={() => { (window as unknown as Record<string, () => void>).__extendSession?.(); }}>Extend Session</button>
              <button className="btn-secondary" style={{ flex: 1, padding: "12px 20px" }} onClick={() => handleLogout("Session Timeout")}>Log Out Now</button>
            </div>
          </div>
        </div>
      )}

      </div>
    </div>
  );
}
