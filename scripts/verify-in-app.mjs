#!/usr/bin/env node
// Verification tool for Branch app changes: start a scratch instance, navigate to screens, and screenshot.
// Uses the engine's ui_* tools (ui_open, ui_navigate, ui_screenshot, ui_snapshot).

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openTestInstance } from "../engine/src/mcp/ui-target.js";
import { locate } from "../engine/src/mcp/ui-tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

/**
 * Navigate to a screen using the ui_navigate pattern.
 * @param {import('playwright-core').Page} page
 * @param {string} path - Navigation path like "Settings › Usage" or "Canopy"
 */
async function navigate(page, path) {
  if (!path) return;
  
  if (path.toLowerCase() === "reload") {
    await page.reload();
    return;
  }

  const steps = path.split(/\s*(?:›|>)\s*/).filter(Boolean);
  for (const step of steps) {
    const button = locate(page, { name: step });
    await button.click({ timeout: 10_000 });
    // Brief wait for navigation
    await page.waitForTimeout(500);
  }
}

/**
 * Screenshot a screen or control.
 * @param {import('playwright-core').Page} page
 * @param {object} options
 * @param {string} [options.ref] - Snapshot ref like "e12"
 * @param {string} [options.name] - Control name
 * @param {boolean} [options.fullPage] - Full page screenshot
 */
async function screenshot(page, options = {}) {
  const { ref, name, fullPage } = options;
  
  if (ref || name) {
    const element = locate(page, { ref, name });
    return await element.screenshot({ timeout: 10_000 });
  }
  
  return await page.screenshot({ fullPage: fullPage ?? false });
}

/**
 * Get accessibility snapshot for a page or control.
 * @param {import('playwright-core').Page} page
 * @param {object} [options]
 */
async function snapshot(page, options = {}) {
  const { ref, name } = options;
  
  if (ref || name) {
    const element = locate(page, { ref, name });
    return await element.ariaSnapshot({ mode: "ai" });
  }
  
  return await page.ariaSnapshot({ mode: "ai" });
}

/**
 * Main verification workflow.
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help") {
    console.log(`
Branch App Verification Tool

Usage: node scripts/verify-in-app.mjs <command> [options]

Commands:
  screenshot <nav-path> <output-path>
    Navigate to a screen and save a screenshot
    Example: node scripts/verify-in-app.mjs screenshot "Settings › Usage" screenshots/usage.png

  multi-screenshot <json-config>
    Screenshot multiple screens from a JSON config file
    Config format: [{"path": "Settings › Usage", "output": "usage.png"}, ...]

  snapshot <nav-path>
    Navigate to a screen and print its accessibility tree
    Example: node scripts/verify-in-app.mjs snapshot "Canopy"

Options:
  --full-page    Take a full-page screenshot (default: viewport only)
  --first-run    Start on first-run setup instead of main window

Examples:
  # Screenshot the Overview place
  node scripts/verify-in-app.mjs screenshot Overview screenshots/overview.png

  # Screenshot Settings › Usage with full page
  node scripts/verify-in-app.mjs screenshot "Settings › Usage" screenshots/usage.png --full-page

  # Get accessibility tree of Inbox
  node scripts/verify-in-app.mjs snapshot Inbox

  # Screenshot multiple screens
  node scripts/verify-in-app.mjs multi-screenshot screens.json
`);
    process.exit(0);
  }

  const command = args[0];
  const fullPage = args.includes("--full-page");
  const firstRun = args.includes("--first-run");

  console.log("🚀 Starting scratch Branch instance...");
  const target = await openTestInstance(process.env, { firstRun });
  
  try {
    const { page } = target;
    
    // Wait for the app to be ready
    await page.waitForLoadState("networkidle");
    console.log("✅ Branch instance ready");
    
    if (command === "screenshot") {
      const navPath = args[1];
      const outputPath = args[2];
      
      if (!navPath || !outputPath) {
        console.error("❌ Usage: screenshot <nav-path> <output-path>");
        process.exit(1);
      }
      
      console.log(`📍 Navigating to: ${navPath}`);
      await navigate(page, navPath);
      
      // Wait for any animations
      await page.waitForTimeout(1000);
      
      console.log(`📸 Taking screenshot: ${outputPath}`);
      const image = await screenshot(page, { fullPage });
      
      // Ensure output directory exists
      const outputDir = dirname(join(ROOT, outputPath));
      mkdirSync(outputDir, { recursive: true });
      
      writeFileSync(join(ROOT, outputPath), image);
      console.log(`✅ Screenshot saved: ${outputPath}`);
      
    } else if (command === "multi-screenshot") {
      const configPath = args[1];
      if (!configPath) {
        console.error("❌ Usage: multi-screenshot <json-config>");
        process.exit(1);
      }
      
      const config = JSON.parse(readFileSync(join(ROOT, configPath), "utf8"));
      
      for (const item of config) {
        const { path: navPath, output: outputPath, label } = item;
        
        console.log(`\n📍 ${label || navPath}`);
        console.log(`   Navigating to: ${navPath}`);
        await navigate(page, navPath);
        await page.waitForTimeout(1000);
        
        console.log(`   Taking screenshot: ${outputPath}`);
        const image = await screenshot(page, { fullPage: item.fullPage ?? fullPage });
        
        const outputDir = dirname(join(ROOT, outputPath));
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(join(ROOT, outputPath), image);
        console.log(`   ✅ Saved: ${outputPath}`);
      }
      
      console.log(`\n✅ All screenshots complete`);
      
    } else if (command === "snapshot") {
      const navPath = args[1];
      
      if (!navPath) {
        console.error("❌ Usage: snapshot <nav-path>");
        process.exit(1);
      }
      
      console.log(`📍 Navigating to: ${navPath}`);
      await navigate(page, navPath);
      await page.waitForTimeout(1000);
      
      console.log("📋 Accessibility snapshot:\n");
      const tree = await snapshot(page);
      console.log(tree);
      
    } else {
      console.error(`❌ Unknown command: ${command}`);
      console.error('Use --help for usage information');
      process.exit(1);
    }
    
  } finally {
    console.log("\n🧹 Cleaning up...");
    await target.close();
    console.log("✅ Done");
  }
}

main().catch(error => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
