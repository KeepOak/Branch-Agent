import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../../scripts/feature-batch-ci-runtime.mjs";

const desktop = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npmDirectory = process.platform === "win32" ? dirname(process.execPath) : join(dirname(process.execPath), "../lib");
await run(process.execPath, [join(npmDirectory, "node_modules/npm/bin/npm-cli.js"), "ci", "--ignore-scripts", "--no-audit", "--no-fund"], desktop);
await run(process.execPath, [join(desktop, "scripts/build.mjs")], desktop);
