#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const SCRIPT = join(import.meta.dirname, "feature-map-check.mjs");

test("feature-map-check: passes on valid map with all sources present", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "feature-map-test-"));
  try {
    const map = {
      places: [
        { id: "test", sources: ["scripts/feature-map-check.test.mjs"] },
      ],
      commonControls: [
        { sources: ["scripts/feature-map-check.mjs"] },
      ],
    };
    const mapPath = join(tmpDir, "feature-map.json");
    writeFileSync(mapPath, JSON.stringify(map));
    
    // Should exit 0 when all paths exist
    const result = execFileSync("node", [SCRIPT], {
      cwd: import.meta.dirname + "/..",
      env: { ...process.env, FEATURE_MAP_PATH: mapPath },
      encoding: "utf8",
    });
    
    assert.ok(result.includes("✅"));
    assert.ok(result.includes("2 source files exist"));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("feature-map-check: fails on missing source path", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "feature-map-test-"));
  try {
    const map = {
      places: [
        { id: "test", sources: ["nonexistent/file.ts", "scripts/feature-map-check.mjs"] },
      ],
    };
    const mapPath = join(tmpDir, "feature-map.json");
    writeFileSync(mapPath, JSON.stringify(map));
    
    // Should exit 1 when paths are missing
    try {
      execFileSync("node", [SCRIPT], {
        cwd: import.meta.dirname + "/..",
        env: { ...process.env, FEATURE_MAP_PATH: mapPath },
        encoding: "utf8",
      });
      assert.fail("Expected command to fail but it succeeded");
    } catch (error) {
      assert.strictEqual(error.status, 1);
      const output = (error.stdout || "") + (error.stderr || "");
      assert.ok(output.includes("❌") || output.includes("source file"));
      assert.ok(output.includes("nonexistent/file.ts"));
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("feature-map-check: fails on invalid JSON", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "feature-map-test-"));
  try {
    const mapPath = join(tmpDir, "feature-map.json");
    writeFileSync(mapPath, "{invalid json");
    
    // Should exit 1 on parse error
    try {
      execFileSync("node", [SCRIPT], {
        cwd: import.meta.dirname + "/..",
        env: { ...process.env, FEATURE_MAP_PATH: mapPath },
        encoding: "utf8",
      });
      assert.fail("Expected command to fail but it succeeded");
    } catch (error) {
      assert.strictEqual(error.status, 1);
      const output = (error.stdout || "") + (error.stderr || "");
      assert.ok(output.includes("❌") || output.includes("parse") || output.includes("Failed"));
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("feature-map-check: handles map with tabs and pages", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "feature-map-test-"));
  try {
    const map = {
      places: [
        {
          id: "test",
          sources: ["scripts/feature-map-check.mjs"],
          tabs: [{ id: "tab1", sources: ["scripts/feature-map-check.test.mjs"] }],
          pages: [{ id: "page1", sources: ["docs/feature-map.json"] }],
        },
      ],
      keyNavigationPatterns: [
        { pattern: "test", sources: ["docs/feature-map-index.md"] },
      ],
    };
    const mapPath = join(tmpDir, "feature-map.json");
    writeFileSync(mapPath, JSON.stringify(map));
    
    const result = execFileSync("node", [SCRIPT], {
      cwd: import.meta.dirname + "/..",
      env: { ...process.env, FEATURE_MAP_PATH: mapPath },
      encoding: "utf8",
    });
    
    assert.ok(result.includes("✅"));
    assert.ok(result.includes("4 source files exist"));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
