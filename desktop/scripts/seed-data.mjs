// One-time setup of the desktop app's own data folder (C:/Users/you/BranchApp by default).
// Copies the early copy's engine config (model provider, Sapling identity) with its paths moved to the app's folder,
// and writes a fresh gateway token. Prints no secrets. Leaves an existing config or token alone.
//   node desktop/scripts/seed-data.mjs [fromDir] [toDir]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

// JSON paths stay slash-normalized even when Windows callers pass native backslashes.
const from = (process.argv[2] ?? "C:/Users/you/BranchEarly").replaceAll("\\", "/");
const to = (process.argv[3] ?? "C:/Users/you/BranchApp").replaceAll("\\", "/");
const winPath = (p) => p.replaceAll("/", "\\\\");

const target = join(to, "home", ".branch", "branch.json");
if (existsSync(target)) {
  console.log("config already present:", target);
} else {
  const raw = readFileSync(join(from, "home", ".branch", "branch.json"), "utf8");
  const moved = raw.replaceAll(winPath(from), winPath(to)).replaceAll(from, to);
  mkdirSync(join(to, "home", ".branch"), { recursive: true });
  writeFileSync(target, moved);
  console.log("config written:", target);
}

const tokenFile = join(to, "gateway-token");
if (existsSync(tokenFile)) {
  console.log("token already present:", tokenFile);
} else {
  writeFileSync(tokenFile, randomBytes(24).toString("hex"), { mode: 0o600 });
  console.log("token written:", tokenFile);
}
