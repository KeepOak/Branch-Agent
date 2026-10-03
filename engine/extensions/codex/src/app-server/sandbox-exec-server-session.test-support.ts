import type { SandboxContext } from "branch/plugin-sdk/sandbox";
import type { BranchExecServer } from "./sandbox-exec-server/types.js";

export function createSessionExecServer(sandbox: SandboxContext): BranchExecServer {
  if (!sandbox.backend || !sandbox.fsBridge) {
    throw new Error("Sandbox fixture requires an execution and filesystem owner");
  }
  return {
    environmentId: "session-test",
    authPath: "/session-test",
    refCount: 1,
    closed: false,
    url: "ws://localhost/session-test",
    server: { clients: [], close: (callback) => callback() },
    networkIsolated: true,
    sandbox,
    backend: sandbox.backend,
    fsBridge: sandbox.fsBridge,
    children: new Set(),
    cleanupTasks: new Set(),
  };
}
