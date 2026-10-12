#!/usr/bin/env node
// Lists unique data-act keys and mi() menu labels from design/spec-v23/index.html.
// The curated destinations live in docs/parity/preview-button-map.json.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const html = readFileSync(join(root, "design/spec-v23/index.html"), "utf8");
const acts = [...html.matchAll(/data-act=["']([^"']+)["']/g)].map((m) => m[1]).filter((a) => !a.includes("${"));
const unique = [...new Set(acts)].sort();
const menus = [...html.matchAll(/mi\(\s*['"]([^'"]+)['"]\s*,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/g)].map((m) => ({ act: m[1], label: m[2] }));
const labels = [...new Set(menus.map((m) => m.label))].sort();

const map = JSON.parse(readFileSync(join(root, "docs/parity/preview-button-map.json"), "utf8"));
const missingFiles = [...new Set(map.map((e) => e.appFile).filter((p) => p && !existsSync(join(root, p))))].sort();
if (missingFiles.length) {
  process.stderr.write(`appFile path does not exist:\n${missingFiles.map((p) => `  ${p}\n`).join("")}`);
  process.exit(1);
}

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify({ actCount: unique.length, acts: unique, menuLabelCount: labels.length, menuLabels: labels }, null, 2)}\n`);
} else {
  process.stdout.write(`${unique.length} unique data-act keys (interpolated templates omitted)\n${labels.length} unique mi() labels\n`);
}
