import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { MAC_BROKER_CLIENT } from "./mcp-driver-client.js";

describe("Mac driver broker client", () => {
  it("authenticates and relays bytes without exposing the secret in process arguments", async () => {
    const secret = "a".repeat(64);
    let authenticated = false;
    const server = createServer(socket => {
      let pending = Buffer.alloc(0);
      socket.on("data", chunk => {
        pending = Buffer.concat([pending, chunk]);
        const newline = pending.indexOf(10);
        if (newline < 0) return;
        authenticated = pending.subarray(0, newline).toString() === secret;
        if (!authenticated) { socket.destroy(); return; }
        if (pending.subarray(newline + 1).toString() === "ping") socket.end("pong");
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("broker did not bind");
    const child = spawn(process.execPath, ["-e", MAC_BROKER_CLIENT], {
      env: { ...process.env, BRANCH_CUA_BROKER_PORT: String(address.port), BRANCH_CUA_BROKER_SECRET: secret },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      const output = once(child.stdout!, "data");
      child.stdin!.write("ping");
      expect((await output)[0].toString()).toBe("pong");
      expect(authenticated).toBe(true);
      expect(child.spawnargs.join(" ")).not.toContain(secret);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await once(child, "exit").catch(() => undefined);
      }
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 10_000);
});
