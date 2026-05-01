import fs from "fs";
import nodemailer from "nodemailer";
import { resolveAppPath } from "./app-root";

const STATE_FILE = resolveAppPath("low_inventory_alert_state.json");
const THRESHOLD = 10;
const INTERVAL_DAYS = 7;
const RECIPIENTS = ["bagasti@apple.com"];

interface AlertState {
  low_active: boolean;
  last_sent_at: string;
  last_sent_count: number | null;
}

function readState(): AlertState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return { low_active: false, last_sent_at: "", last_sent_count: null };
}

function writeState(state: AlertState) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8"); } catch {}
}

async function sendEmail(count: number): Promise<boolean> {
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "sunil.agasti937@gmail.com", pass: "cmmcpmvqgcgyelec" },
    });
    const now = new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" });
    await transporter.sendMail({
      from: "sunil.agasti937@gmail.com",
      to: RECIPIENTS.join(", "),
      subject: `[Action Required] Asset Closet Inventory Low - ${count} Assets Remaining`,
      text: `Hello Leadership Team,\n\nInventory has dropped below threshold.\n\nCurrent total: ${count}\nThreshold: ${THRESHOLD}\nDetected: ${now}\n\nPlease review and initiate replenishment.\n\nRegards,\nAsset Closet Monitoring Service`,
      html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto"><div style="background:#7c2d12;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0"><h2 style="margin:0">Asset Closet - Low Inventory Alert</h2></div><div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-radius:0 0 14px 14px"><p>Current total assets: <strong>${count}</strong></p><p>Threshold: ≤ ${THRESHOLD}</p><p>Detected: ${now}</p><p><strong>Please review and initiate replenishment.</strong></p><p style="color:#6b7280;font-size:13px">This alert is sent at most once every 7 days.</p></div></div>`,
    });
    return true;
  } catch {
    return false;
  }
}

export async function checkLowInventory(currentCount: number): Promise<{ isLow: boolean; sentNow: boolean }> {
  if (currentCount > THRESHOLD) {
    writeState({ low_active: false, last_sent_at: "", last_sent_count: null });
    return { isLow: false, sentNow: false };
  }

  const state = readState();
  if (state.last_sent_at) {
    const lastSent = new Date(state.last_sent_at);
    const nextSend = new Date(lastSent.getTime() + INTERVAL_DAYS * 86400000);
    if (new Date() < nextSend) return { isLow: true, sentNow: false };
  }

  const sent = await sendEmail(currentCount);
  if (sent) {
    writeState({ low_active: true, last_sent_at: new Date().toISOString(), last_sent_count: currentCount });
  }
  return { isLow: true, sentNow: sent };
}

export const LOW_INVENTORY_THRESHOLD = THRESHOLD;
