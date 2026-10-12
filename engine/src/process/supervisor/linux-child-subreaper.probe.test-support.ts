// Written by Branch for SESSIONS-0102: built Linux child owner probes; not copied.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLinuxChildSubreaper } from "./linux-child-subreaper.js";

function parentPid(pid: number): number | null {
  try {
    const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
    return Number(
      stat
        .slice(stat.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/u)[1],
    );
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const mode = process.argv[2];
if (mode === "existing-child") {
  // A child spawned before admission must be refused, whichever census sees it.
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    stdio: "ignore",
  });
  await once(child, "spawn");
  let outcome = "admitted";
  try {
    acquireLinuxChildSubreaper();
  } catch (error) {
    outcome = (error as Error).message;
  }
  child.kill("SIGKILL");
  await once(child, "exit");
  process.stdout.write(JSON.stringify({ outcome }));
} else if (mode === "adopted-orphan") {
  // The root leaves a TERM-handling grandchild behind; the owner adopts,
  // signals and reaps it only if its census can discover it.
  const owner = acquireLinuxChildSubreaper();
  const root = spawn(
    process.execPath,
    [
      "-e",
      'const g = require("node:child_process").spawn(process.execPath, ["-e", "process.on(\'SIGTERM\', () => process.exit(23)); setInterval(() => {}, 1000); process.stdout.write(\'ready\')"], { stdio: ["ignore", "pipe", "ignore"] }); g.stdout.once("data", () => { process.stdout.write(String(g.pid)); process.exit(0); });',
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  if (!root.pid) {
    throw new Error("root did not spawn");
  }
  owner.retainLibuvChild(root.pid, root);
  let printed = "";
  root.stdout.on("data", (chunk: Buffer) => {
    printed += chunk.toString("utf8");
  });
  await once(root, "close");
  const orphan = Number(printed);
  const deadline = Date.now() + 5_000;
  while (parentPid(orphan) !== process.pid && Date.now() < deadline) {
    await delay(10);
  }
  const adopted = parentPid(orphan) === process.pid;
  let extinct = owner.drain("SIGTERM");
  while (!extinct && Date.now() < deadline) {
    await delay(20);
    extinct = owner.drain("SIGTERM");
  }
  const orphanAlive = alive(orphan);
  if (orphanAlive) {
    process.kill(orphan, "SIGKILL");
  }
  process.stdout.write(JSON.stringify({ adopted, extinct, orphanAlive }));
} else {
  throw new Error("unknown probe mode: " + String(mode));
}
