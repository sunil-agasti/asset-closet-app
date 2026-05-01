"use client";
import { useState, useRef, useCallback, useEffect } from "react";

declare global {
  interface Window {
    Tesseract?: {
      recognize: (img: string, lang: string, opts?: Record<string, unknown>) => Promise<{ data: { text: string } }>;
    };
  }
}

export interface ScanResult {
  assetId: string;
  serial: string;
  raw: string;
}

const ASSET_PATTERNS = [
  /0[12]HW[0O]\s*\d{4,6}/gi,
  /[34]HW[0O]\s*\d{4,6}/gi,
  /34HW[0O]\s*\d{4,6}/gi,
];

function normalizeAssetId(raw: string): string {
  let s = raw.toUpperCase().replace(/\s/g, "").replace(/O/g, "0");
  const m = s.match(/(\d{1,2}HW0)(\d{5,6})/);
  if (m) return `${m[1]}${m[2].slice(-5)}`;
  return "";
}

function extractAssetId(text: string): string {
  const upper = text.toUpperCase().replace(/O2HW/g, "02HW").replace(/O1HW/g, "01HW");
  for (const pat of ASSET_PATTERNS) {
    pat.lastIndex = 0;
    const m = pat.exec(upper);
    if (m) {
      const id = normalizeAssetId(m[0]);
      if (id) return id;
    }
  }
  const compact = upper.replace(/[^0-9A-Z]/g, "");
  const m2 = compact.match(/0[12]HW0\d{5}/);
  if (m2) return m2[0];
  const m3 = compact.match(/[34]HW0\d{5}/);
  if (m3) return m3[0];
  return "";
}

function extractSerial(text: string, assetId: string): string {
  const upper = text.toUpperCase();
  const patterns = [
    /SERIAL\s*(?:NUMBER)?\s*[:#.]?\s*([A-Z0-9]{8,15})/i,
    /SERIAL\s+([A-Z0-9]{3,8})\s*([A-Z0-9]{3,8})/i,
    /S\s*\/\s*N\s*[:#.]?\s*([A-Z0-9]{8,15})/i,
    /SN\s*[:#.]?\s*([A-Z0-9]{8,15})/i,
  ];
  for (const pat of patterns) {
    const m = upper.match(pat);
    if (m) {
      const candidate = (m[2] ? m[1] + m[2] : m[1]).replace(/\s/g, "").toUpperCase();
      if (candidate.length >= 8 && candidate.length <= 15 && candidate !== assetId) return candidate;
    }
  }
  return "";
}

function loadTesseract(): Promise<void> {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (document.getElementById("tesseract-js")) {
      const check = setInterval(() => { if (window.Tesseract) { clearInterval(check); resolve(); } }, 100);
      setTimeout(() => { clearInterval(check); reject(new Error("Timeout loading OCR")); }, 10000);
      return;
    }
    const script = document.createElement("script");
    script.id = "tesseract-js";
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => {
      const check = setInterval(() => { if (window.Tesseract) { clearInterval(check); resolve(); } }, 50);
      setTimeout(() => { clearInterval(check); reject(new Error("Timeout")); }, 5000);
    };
    script.onerror = () => reject(new Error("Failed to load OCR library"));
    document.head.appendChild(script);
  });
}

interface CameraScannerProps {
  onScan: (result: ScanResult) => void;
  assetOnly?: boolean;
}

export default function CameraScanner({ onScan, assetOnly = false }: CameraScannerProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOpen(false);
    setBusy(false);
    setStatus("");
  }, []);

  useEffect(() => { return cleanup; }, [cleanup]);

  const enhanceImage = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const enhanced = gray < 128 ? Math.max(0, gray * 0.6) : Math.min(255, gray * 1.3 + 30);
      d[i] = d[i + 1] = d[i + 2] = enhanced;
    }
    ctx.putImageData(imageData, 0, 0);
  };

  const processImage = (source: HTMLVideoElement | HTMLImageElement): string => {
    const canvas = canvasRef.current;
    if (!canvas) return "";
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const sw = "videoWidth" in source ? source.videoWidth : source.naturalWidth;
    const sh = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    const scale = Math.min(1, 1400 / Math.max(sw, sh));
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    enhanceImage(canvas, ctx);
    return canvas.toDataURL("image/png");
  };

  const runOcr = async (dataUrl: string): Promise<ScanResult> => {
    setStatus("Loading OCR engine...");
    await loadTesseract();
    setStatus("Reading text...");
    const result = await window.Tesseract!.recognize(dataUrl, "eng");
    const text = result.data.text || "";
    const assetId = extractAssetId(text);
    const serial = assetOnly ? "" : extractSerial(text, assetId);
    return { assetId, serial, raw: text };
  };

  const handleCapture = async () => {
    if (busy || !videoRef.current) return;
    setBusy(true);
    try {
      const dataUrl = processImage(videoRef.current);
      if (!dataUrl) { setStatus("No video frame"); setBusy(false); return; }
      const result = await runOcr(dataUrl);
      if (!result.assetId && !result.serial) {
        setStatus("Nothing found. Move closer or try photo upload.");
        setBusy(false);
        return;
      }
      onScan(result);
      cleanup();
    } catch {
      setStatus("OCR failed. Try photo upload instead.");
      setBusy(false);
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    setStatus("Processing photo...");
    try {
      const img = new Image();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });
      const enhanced = processImage(img);
      const result = await runOcr(enhanced);
      if (!result.assetId && !result.serial) {
        setStatus("No Asset ID or Serial found in photo. Try a clearer image.");
        setBusy(false);
        return;
      }
      onScan(result);
      cleanup();
    } catch {
      setStatus("Failed to process photo.");
      setBusy(false);
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const openCamera = async () => {
    setOpen(true);
    setStatus("Opening camera...");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setStatus("Aim at sticker/serial and tap Capture.");
    } catch {
      setStatus("Camera unavailable. Use Upload Photo.");
    }
  };

  if (!open) {
    return (
      <button type="button" className="dash-scan-btn" onClick={openCamera} title="Scan with camera">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 4.5a1.5 1.5 0 0 0-1.342.829L7.118 6.4H5.75A2.75 2.75 0 0 0 3 9.15v8.1A2.75 2.75 0 0 0 5.75 20h12.5A2.75 2.75 0 0 0 21 17.25v-8.1A2.75 2.75 0 0 0 18.25 6.4h-1.368l-.54-1.071A1.5 1.5 0 0 0 15 4.5H9Zm3 4.1a4.15 4.15 0 1 1 0 8.3 4.15 4.15 0 0 1 0-8.3Zm0 1.8a2.35 2.35 0 1 0 0 4.7 2.35 2.35 0 0 0 0-4.7Z"/></svg>
      </button>
    );
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 200 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, background: "#0b1220", color: "#e5e7eb", padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <strong style={{ fontSize: 15 }}>Scan {assetOnly ? "Asset ID" : "Asset ID / Serial"}</strong>
          <button onClick={cleanup} style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 8, padding: "6px 16px", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
            Close
          </button>
        </div>
        <div style={{ position: "relative", padding: "8px 16px 0" }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", borderRadius: 12, background: "#000", maxHeight: "45vh", display: "block" }} />
          <div style={{ position: "absolute", inset: "18px 26px", borderRadius: 14, border: "2px solid rgba(59,130,246,0.5)", pointerEvents: "none" }} />
        </div>
        <canvas ref={canvasRef} style={{ display: "none" }} />
        <div style={{ padding: "12px 16px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={handleCapture} disabled={busy} style={{ padding: "10px 18px", borderRadius: 10, background: "#2563eb", color: "#fff", border: "none", fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1, fontSize: 14 }}>
            Capture & Read
          </button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} style={{ padding: "10px 18px", borderRadius: 10, background: "rgba(255,255,255,0.1)", color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.15)", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>
            Upload Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: "none" }} />
          <span style={{ fontSize: 13, flex: 1, minWidth: 180, color: busy ? "#93c5fd" : "rgba(255,255,255,0.7)" }}>{status}</span>
        </div>
      </div>
    </div>
  );
}
