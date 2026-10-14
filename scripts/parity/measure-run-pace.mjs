#!/usr/bin/env node
// Source-checkout extension for X09, which is absent from the legacy live scorecard.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/parity/measure-run-pace.mjs <output-directory>");
const checks = [
  { cwd: "engine", command: process.execPath, args: ["scripts/run-vitest.mjs", "run", "src/infra/agent-run-pace.test.ts"] },
  { cwd: "window", command: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", "src/places/canopy/canopy.test.tsx", "src/places/overview/overview.test.tsx", "-t", "shows.*observed pace and ETA range"] },
];
const results = checks.map(check => {
  const result = spawnSync(check.command, check.args, {
    cwd: resolve(root, check.cwd), encoding: "utf8", windowsHide: true,
    timeout: 15 * 60 * 1000,
  });
  // Keep raw execution logs with the caller's output, never add local paths to the report.
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, `${check.cwd}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  return { area: check.cwd, passed: result.status === 0 && /Tests\s+\d+ passed/.test(result.stdout ?? "") };
});
const report = { id: "X09", verdict: results.every(r => r.passed) ? "PASS" : "FAIL", scope: "source checkout; fixed-timing event regression and overview rendering, not installed-release verification", checks: results };
writeFileSync(resolve(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`X09 ${report.verdict} — ${report.scope}`);
process.exitCode = report.verdict === "PASS" ? 0 : 1;
