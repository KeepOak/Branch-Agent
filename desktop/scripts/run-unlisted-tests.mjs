// Runs desktop test files that no step in .github/workflows/desktop-checks.yml names.
// A new desktop test file is picked up here until someone gives it its own step.
// Plain Node, no dependencies. Run from desktop/: node scripts/run-unlisted-tests.mjs
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// One line per file (desktop-relative path), with a plain reason it must not run here.
export const EXCLUDED = [
];

const TEST_DIRS = [
  { dir: "scripts", suffix: ".test.mjs" },
  { dir: "src", suffix: ".test.ts" },
];

// Every desktop test file on disk, as desktop-relative paths like scripts/x.test.mjs.
export function findDesktopTests(desktopDir) {
  const found = [];
  for (const { dir, suffix } of TEST_DIRS) {
    const full = join(desktopDir, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) if (name.endsWith(suffix)) found.push(`${dir}/${name}`);
  }
  return found.sort();
}

// Desktop test files the workflow's steps already name. Steps run from desktop/ by default and name
// scripts/x.test.mjs or src/x.test.ts; steps that set working-directory to the repo root name desktop/scripts/x.test.mjs.
export function namedInWorkflow(workflowText) {
  const named = new Set();
  const lines = workflowText.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*steps:\s*$/.test(line));
  if (start < 0) return named;
  const steps = [];
  let current = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*-\s+(name|uses|run):/.test(line)) {
      current = [];
      steps.push(current);
    }
    if (current) current.push(line);
  }
  for (const step of steps) {
    const text = step.join("\n");
    const fromRoot = /working-directory:\s*['"]?\$\{\{\s*github\.workspace\s*\}\}['"]?\s*$/m.test(text);
    for (const match of text.matchAll(/(?:^|[\s'"=])((?:desktop\/)?(?:scripts|src)\/[\w.-]+\.test\.(?:mjs|ts))(?=$|[\s'"])/gm)) {
      const path = match[1];
      if (fromRoot) {
        if (path.startsWith("desktop/")) named.add(path.slice("desktop/".length));
      } else if (!path.startsWith("desktop/")) {
        named.add(path);
      }
    }
  }
  return named;
}

// The pure picking step: files on disk, minus files a step names, minus EXCLUDED.
export function pickUnlistedTests({ desktopDir, workflowPath, excluded = EXCLUDED }) {
  const named = namedInWorkflow(readFileSync(workflowPath, "utf8"));
  const skip = new Set(excluded.map(([file]) => file));
  return findDesktopTests(desktopDir).filter((file) => !named.has(file) && !skip.has(file));
}

function main() {
  const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  const workflowPath = join(desktopDir, "..", ".github", "workflows", "desktop-checks.yml");
  const picked = pickUnlistedTests({ desktopDir, workflowPath });
  for (const [file, reason] of EXCLUDED) console.log(`Excluded ${file}: ${reason}`);
  if (picked.length === 0) {
    console.log("No desktop test files outside the named steps. Nothing to run.");
    return 0;
  }
  console.log(`Running ${picked.length} desktop test file(s) that no step names:`);
  for (const file of picked) console.log(`  ${file}`);
  const result = spawnSync(process.execPath, ["--test", ...picked], { cwd: desktopDir, stdio: "inherit" });
  if (result.error) {
    console.error(`Could not start node --test: ${result.error.message}`);
    return 1;
  }
  return result.status === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = main();
