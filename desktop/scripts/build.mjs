import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const compile = spawnSync(process.execPath, [
  fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url)),
  "-p", fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
], { cwd: desktop, stdio: "inherit", windowsHide: true });
if (compile.error) throw compile.error;
if (compile.status !== 0) process.exit(compile.status ?? 1);
// Package the one canonical implementation; the shell cannot rely on an engine install.
copyFileSync(new URL("../../engine/scripts/lib/available-memory.mjs", import.meta.url),
  new URL("../dist/available-memory-core.mjs", import.meta.url));
