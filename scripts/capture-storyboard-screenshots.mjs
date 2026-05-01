import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "public", "storyboard", "screenshots");

const baseUrl = (process.env.ASSET_CLOSET_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const empId = (process.env.STORYBOARD_EMP_ID || "").trim();
const pin = (process.env.STORYBOARD_PIN || "").trim();
const viewport = {
  width: Number(process.env.STORYBOARD_VIEWPORT_WIDTH || 820),
  height: Number(process.env.STORYBOARD_VIEWPORT_HEIGHT || 1180),
};

const helpRequested = process.argv.includes("--help") || process.argv.includes("-h");

const screenshotPlan = [
  "login-page-light.png",
  "login-page-dark.png",
  "pin-screen.png",
  "forgot-password-screen.png",
  "check-in-asset-screen.png",
  "check-out-screen.png",
  "inventory.png",
  "inventory-with-settings.png",
  "edit-asset-inventory.png",
  "inventory-dark.png",
  "user-audit.png",
  "asset-logs.png",
];

function printHelp() {
  console.log(`Asset Closet storyboard screenshot refresh

Usage:
  npm run storyboard:capture

Optional environment variables:
  ASSET_CLOSET_BASE_URL             App URL. Default: http://127.0.0.1:3001
  STORYBOARD_EMP_ID                 Employee ID for dashboard captures
  STORYBOARD_PIN                    4-digit PIN for dashboard captures
  PLAYWRIGHT_CHROMIUM_EXECUTABLE    Override browser executable path
  STORYBOARD_VIEWPORT_WIDTH         Default: 820
  STORYBOARD_VIEWPORT_HEIGHT        Default: 1180

Output directory:
  ${outputDir}

Files refreshed:
  ${screenshotPlan.join("\n  ")}
`);
}

function resolveExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    path.join(
      os.homedir(),
      "Library",
      "Caches",
      "ms-playwright",
      "chromium-1217",
      "chrome-mac-arm64",
      "Google Chrome for Testing.app",
      "Contents",
      "MacOS",
      "Google Chrome for Testing",
    ),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);

  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error(
      "No Chromium executable found. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to a valid browser binary.",
    );
  }
  return executablePath;
}

async function ensureOutputDir() {
  await fs.mkdir(outputDir, { recursive: true });
}

function screenshotPath(name) {
  return path.join(outputDir, name);
}

async function saveScreenshot(page, filename) {
  await page.waitForTimeout(450);
  await page.screenshot({
    path: screenshotPath(filename),
    fullPage: true,
  });
  console.log(`saved ${filename}`);
}

async function waitForPageIdle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(500);
}

async function openLogin(page, theme = "light") {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await waitForPageIdle(page);

  const themeButton = page.getByRole("button", { name: /Dark|Light/i });
  const label = (await themeButton.textContent()) || "";
  const inDarkMode = label.includes("Light");

  if (theme === "dark" && !inDarkMode) {
    await themeButton.click();
    await page.waitForTimeout(350);
  }

  if (theme === "light" && inDarkMode) {
    await themeButton.click();
    await page.waitForTimeout(350);
  }
}

async function goToPinScreen(page) {
  if (!empId) {
    throw new Error("STORYBOARD_EMP_ID is required for PIN and dashboard captures.");
  }

  await openLogin(page, "light");
  await page.getByLabel("Employee ID").fill(empId);
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByText("Enter your PIN").waitFor({ timeout: 15000 });
  await page.waitForTimeout(350);
}

async function openForgotPin(page) {
  await goToPinScreen(page);
  await page.getByRole("button", { name: /Forgot PIN/i }).click();
  await page.getByText(/Reset PIN for|Set your PIN/i).waitFor({ timeout: 15000 });
  await page.waitForTimeout(350);
}

async function login(page) {
  if (!empId || !pin) {
    throw new Error("STORYBOARD_EMP_ID and STORYBOARD_PIN are required for dashboard captures.");
  }

  await goToPinScreen(page);
  for (const digit of pin) {
    await page.getByRole("button", { name: digit }).click();
  }

  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.getByText(/^Welcome,/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(900);
}

async function clickTab(page, title, readyText) {
  await page.getByTitle(title).click();
  await page.getByText(readyText, { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}

async function capturePublicScreens(page) {
  await openLogin(page, "light");
  await saveScreenshot(page, "login-page-light.png");

  await openLogin(page, "dark");
  await saveScreenshot(page, "login-page-dark.png");

  if (empId) {
    await goToPinScreen(page);
    await saveScreenshot(page, "pin-screen.png");

    await openForgotPin(page);
    await saveScreenshot(page, "forgot-password-screen.png");
  } else {
    console.log("skipped pin-screen.png and forgot-password-screen.png (missing STORYBOARD_EMP_ID)");
  }
}

async function captureDashboardScreens(page) {
  await login(page);

  await clickTab(page, "Check-In", "Check-In Asset");
  await saveScreenshot(page, "check-in-asset-screen.png");

  await clickTab(page, "Check-Out", "Check-Out Asset");
  const checkoutSelect = page.locator("select").first();
  const optionCount = await checkoutSelect.locator("option").count();
  if (optionCount > 1) {
    await checkoutSelect.selectOption({ index: 1 });
    await page.waitForTimeout(500);
  }
  await saveScreenshot(page, "check-out-screen.png");

  await clickTab(page, "Inventory", "Inventory");
  await saveScreenshot(page, "inventory.png");

  await page.getByTitle("Table tools").click();
  await page.locator(".inv-gear-menu").waitFor({ timeout: 10000 });
  await saveScreenshot(page, "inventory-with-settings.png");
  await page.getByTitle("Table tools").click();
  await page.waitForTimeout(300);

  const editButton = page.getByRole("button", { name: "Edit" }).first();
  await editButton.click();
  await page.getByText(/Edit Asset/).waitFor({ timeout: 10000 });
  await saveScreenshot(page, "edit-asset-inventory.png");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(300);

  const themeButton = page.getByRole("button", { name: /Dark|Light/i }).first();
  const label = (await themeButton.textContent()) || "";
  if (label.includes("Dark")) {
    await themeButton.click();
    await page.waitForTimeout(500);
  }
  await saveScreenshot(page, "inventory-dark.png");

  const darkLabel = (await themeButton.textContent()) || "";
  if (darkLabel.includes("Light")) {
    await themeButton.click();
    await page.waitForTimeout(400);
  }

  await clickTab(page, "User Audit", "User Audit");
  await saveScreenshot(page, "user-audit.png");

  await clickTab(page, "Asset Log", "Asset Log");
  await saveScreenshot(page, "asset-logs.png");
}

async function main() {
  if (helpRequested) {
    printHelp();
    return;
  }

  await ensureOutputDir();

  const browser = await chromium.launch({
    executablePath: resolveExecutable(),
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    await capturePublicScreens(page);

    if (empId && pin) {
      await captureDashboardScreens(page);
    } else {
      console.log("skipped dashboard screenshots (missing STORYBOARD_EMP_ID or STORYBOARD_PIN)");
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
