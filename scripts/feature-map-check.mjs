#!/usr/bin/env node
// Check that all source paths in docs/feature-map.json exist.
// Run in CI and locally to validate the feature map stays current.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");

function check() {
  const mapPath = process.env.FEATURE_MAP_PATH ?? join(ROOT, "docs", "feature-map.json");
  
  if (!existsSync(mapPath)) {
    console.error("❌ Feature map not found: docs/feature-map.json");
    return false;
  }

  let map;
  try {
    map = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch (error) {
    console.error("❌ Failed to parse feature-map.json:", error.message);
    return false;
  }

  const sources = new Set();
  let ok = true;

  // Collect all source paths from places
  for (const place of map.places || []) {
    for (const source of place.sources || []) {
      sources.add(source);
    }
    // Check tab sources if present
    for (const tab of place.tabs || []) {
      for (const source of tab.sources || []) {
        sources.add(source);
      }
    }
    // Check page sources (for Settings)
    for (const page of place.pages || []) {
      for (const source of page.sources || []) {
        sources.add(source);
      }
    }
  }

  // Collect sources from common controls
  for (const control of map.commonControls || []) {
    for (const source of control.sources || []) {
      sources.add(source);
    }
  }

  // Collect sources from navigation patterns
  for (const pattern of map.keyNavigationPatterns || []) {
    for (const source of pattern.sources || []) {
      sources.add(source);
    }
  }

  // Verify each source file exists
  const missing = [];
  for (const source of sources) {
    const fullPath = join(ROOT, source);
    if (!existsSync(fullPath)) {
      missing.push(source);
      ok = false;
    }
  }

  if (missing.length > 0) {
    console.error(`❌ ${missing.length} source file(s) listed in feature-map.json do not exist:\n`);
    for (const path of missing.sort()) {
      console.error(`   ${path}`);
    }
    console.error("\nUpdate docs/feature-map.json to remove or correct these paths.");
    return false;
  }

  console.log(`✅ Feature map validated: ${sources.size} source files exist`);
  return true;
}

const success = check();
process.exit(success ? 0 : 1);
