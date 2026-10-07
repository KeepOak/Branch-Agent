import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWindowsSpawnProgram } from "../plugin-sdk/windows-spawn.js";
import { hiddenSpawnOptions } from "./spawn-utils.js";

const engineRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const baselinePath = join(engineRoot, "src/process/windows-hidden-spawn-baseline.json");
const source = (file: string) => readFileSync(join(engineRoot, file), "utf8");

// Raw child_process launches by bare name or through a child_process namespace.
const RAW_CALL = /(?:(?<![.\w$])|\b(?:childProcess|child_process|cp)\.)(spawn|spawnSync|execFile|execFileSync|fork)\s*\(/g;
const HIDDEN = /windowsHide|hiddenSpawnOptions|hiddenWindowsOptions/;

function runtimeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      return /^(?:node_modules|dist|scripts|test|tests|test-utils|__tests__|fixtures|e2e)$/.test(entry.name) ? [] : runtimeFiles(file);
    }
    return /\.[cm]?tsx?$/.test(entry.name) &&
      !/\.d\.[cm]?ts$/.test(entry.name) &&
      !/(?:\.|-)(?:test|spec|e2e|test-support|test-helpers?|test-utils|mock|fixture)s?(?:\.|-)/.test(entry.name)
      ? [file]
      : [];
  });
}

/** The argument text of the call whose "(" sits at `open`, by paren depth. */
function callArguments(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && (depth -= 1) === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

/** Per-file count of raw child_process launches that do not set or default windowsHide. */
function unhiddenSpawnCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of [join(engineRoot, "src"), join(engineRoot, "extensions")].flatMap(runtimeFiles)) {
    const text = readFileSync(file, "utf8");
    if (!/["'](?:node:)?child_process["']/.test(text)) continue;
    let count = 0;
    for (const match of text.matchAll(RAW_CALL)) {
      const open = (match.index ?? 0) + match[0].length - 1;
      if (!HIDDEN.test(callArguments(text, open))) count += 1;
    }
    if (count > 0) counts[relative(engineRoot, file).split("\\").join("/")] = count;
  }
  return Object.fromEntries(Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)));
}

describe("hidden Windows spawn sites", () => {
  it("the Windows spawn resolver always hides its program", () => {
    const base = { platform: "win32" as const, env: {}, execPath: "C:\\node\\node.exe" };
    expect(resolveWindowsSpawnProgram({ ...base, command: "C:\\tools\\codex.exe" }).windowsHide).toBe(true);
    expect(resolveWindowsSpawnProgram({ ...base, command: "C:\\tools\\server.mjs" }).windowsHide).toBe(true);
    expect(hiddenSpawnOptions({ stdio: "ignore" }, "win32")).toEqual({ stdio: "ignore", windowsHide: true });
  });

  it("hides workers and helpers that run outside the launcher's child_process default", () => {
    for (const file of [
      "src/infra/sqlite-integrity-worker.ts",
      "src/state/branch-agent-schema-inspection-worker.ts",
      "src/state/branch-database-verify.impl.ts",
    ]) {
      expect(source(file)).toMatch(/fork\([\s\S]*?windowsHide: true,[\s\S]*?\}\);/);
    }
    expect(source("src/infra/state-migrations.plan.ts")).toContain('{ encoding: "utf8", windowsHide: true }');
    expect(source("src/agents/date-time.ts")).toMatch(/"powershell",[\s\S]*?windowsHide: true/);
    expect(source("src/agents/utils/tools-manager.ts")).toMatch(/spawnSync\(cmd,[\s\S]*?windowsHide: true/);
    expect(source("src/infra/process-respawn.ts")).toContain(
      '...(process.platform === "win32" ? { windowsHide: true } : { detached: true })',
    );
    const handoff = source("src/infra/update-managed-service-handoff.ts");
    expect(handoff).toMatch(/env: params\.serviceManagerEnv,[\s\S]{0,200}windowsHide: true/);
    expect(handoff).toMatch(/detached: true,\s*windowsHide: true,/);
    expect(source("extensions/browser/src/browser/extension-relay-daemon-spawn.ts")).toContain(
      '{ detached: true, stdio: "ignore", windowsHide: true }',
    );
    expect(source("extensions/codex/src/app-server/sandbox-exec-server/sandbox-child.ts")).toMatch(
      /detached: process\.platform !== "win32",\s*windowsHide: true,/,
    );
    expect(source("extensions/codex/src/app-server/transport-process-snapshot.ts")).toMatch(
      /encoding: "utf8",\s*windowsHide: true,/,
    );
  });

  it("flags new raw spawns in engine runtime code that do not hide their window", () => {
    const actual = unhiddenSpawnCounts();
    if (process.env.BRANCH_WRITE_HIDDEN_SPAWN_BASELINE === "1") {
      writeFileSync(baselinePath, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, number>;
    // A count above the baseline is a new unhidden launch: add windowsHide: true (or use
    // spawnProcess / hiddenSpawnOptions). Fixes may lower a count without touching the baseline.
    const added = Object.entries(actual)
      .filter(([file, count]) => count > (baseline[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} unhidden (baseline ${baseline[file] ?? 0})`);
    expect(added).toEqual([]);
  });
});
