#!/usr/bin/env node
// Screenshot verification for Branch app changes.
// Reuses visual-tour's launch, seed, and navigation infrastructure.
//
// Usage:
//   node scripts/verify-in-app-screenshot.mjs Overview
//   node scripts/verify-in-app-screenshot.mjs "Settings › Usage"
//
// Requires: Built engine (dist/) and window (window/dist/), seeded gateway, running services.
// See .github/workflows/visual-tour.yml for the full setup pattern.

import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readScreens } from "./visual-tour/manifest.mjs";

const require = createRequire(new URL("../engine/package.json", import.meta.url));
const { chromium } = require("playwright-core");

// Read env vars set by the launch script (same as visual-tour)
const out = resolve(process.env.VISUAL_OUT ?? "verification-output");
const token = (await readFile(process.env.VISUAL_TOKEN_FILE, "utf8")).trim();
const gateway = `ws://127.0.0.1:${process.env.VISUAL_GATEWAY_PORT}`;
const windowUrl = `http://127.0.0.1:${process.env.VISUAL_WINDOW_PORT}`;

const navPath = process.argv[2];
if (!navPath) {
  console.error("Usage: node verify-in-app-screenshot.mjs <nav-path>");
  console.error("  nav-path: Place name or Settings path like 'Settings › Usage'");
  process.exit(1);
}

// Simple navigation helper - converts "Settings › Usage" to route
function navigationToRoute(path) {
  const lower = path.toLowerCase().trim();
  
  // Direct place names
  const places = ["overview", "canopy", "inbox", "automations", "library", "people", "customize"];
  if (places.includes(lower)) {
    return { kind: "place", place: lower };
  }
  
  // Settings pages
  if (lower.startsWith("settings")) {
    const parts = path.split("›").map(s => s.trim());
    const page = parts[1] ? parts[1].toLowerCase() : "general";
    return { kind: "settings", page };
  }
  
  // Default to chat
  return { kind: "chat", key: null };
}

const route = navigationToRoute(navPath);
const outputName = navPath.toLowerCase().replace(/[›>\s]+/g, "-").replace(/[^a-z0-9-]/g, "");

await mkdir(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "light" });
  const page = await context.newPage();
  
  // Set up Branch desktop environment (same as visual-tour)
  await page.addInitScript(([url, key, look]) => {
    window.branchDesktop = { gatewayUrl: url, gatewayToken: key };
    localStorage.setItem("branch.theme", look);
  }, [gateway, token, "light"]);
  
  // Navigate and wait for connection
  await page.goto(windowUrl, { waitUntil: "domcontentloaded" });
  await page.locator("[data-connection=ready]").waitFor({ timeout: 60000 });
  
  // Set the route
  await page.evaluate((value) => localStorage.setItem("branch.route", JSON.stringify(value)), route);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-connection=ready]").waitFor({ timeout: 60000 });
  
  // Wait for Researcher (the seeded Trunk) to appear
  await page.getByText("Researcher", { exact: true }).first().waitFor({ state: "attached", timeout: 30000 });
  
  // Brief wait for any layout settling
  await page.waitForTimeout(1000);
  
  // Screenshot
  const shotPath = resolve(out, `${outputName}.png`);
  await page.screenshot({ path: shotPath });
  
  console.log(`✅ Screenshot saved: ${shotPath}`);
  console.log(`   Route: ${JSON.stringify(route)}`);
  console.log(`   Navigation: ${navPath}`);
  
  await context.close();
} finally {
  await browser.close();
}
