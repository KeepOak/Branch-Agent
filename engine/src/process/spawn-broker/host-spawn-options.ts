import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpawnOptions } from "node:child_process";
import { hiddenWindowsOptions } from "../windows-hidden-options.js";
import type { BrokerSpawnOptions } from "./protocol.js";

const UNIX_SOCKET_PATH_BYTES = 103;

export function createNativeResourceDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "oc-br-"));
  if (
    process.platform === "win32" ||
    Buffer.byteLength(join(directory, "resource.sock")) <= UNIX_SOCKET_PATH_BYTES
  ) {
    return directory;
  }
  // A configured temp root can exceed Darwin's sockaddr_un even for a short private socket.
  rmSync(directory, { recursive: true, force: true });
  return mkdtempSync("/tmp/oc-br-");
}

export function brokerSpawnOptions(options: SpawnOptions): BrokerSpawnOptions | undefined {
  const stdio = options.stdio ?? "pipe";
  const entries = typeof stdio === "string" ? [stdio, stdio, stdio] : [...stdio];
  const normalized: BrokerSpawnOptions["stdio"] = [];
  for (let fd = 0; fd < Math.max(3, entries.length); fd += 1) {
    const entry = entries[fd] ?? (fd < 3 ? "pipe" : "ignore");
    // Only stdin is inherited by the broker. Numeric/anonymous descriptors stay host-owned.
    if (entry === "inherit" && fd !== 0) {
      return undefined;
    }
    if (entry !== "pipe" && entry !== "ignore" && entry !== "inherit" && entry !== "ipc") {
      return undefined;
    }
    normalized.push(entry);
  }
  if (options.signal || options.timeout || options.killSignal) {
    throw new Error("Unsupported spawn broker cancellation options");
  }
  return {
    cwd: options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd,
    env: options.env ? { ...options.env } : { ...process.env },
    argv0: options.argv0,
    detached: options.detached,
    shell: options.shell,
    windowsHide: hiddenWindowsOptions(options).windowsHide,
    windowsVerbatimArguments: options.windowsVerbatimArguments,
    serialization: options.serialization,
    uid: options.uid,
    gid: options.gid,
    stdio: normalized,
  };
}
