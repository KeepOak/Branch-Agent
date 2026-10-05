// Branch-to-Branch against two real scratch engines (own homes, state and free loopback ports; never the owner's
// app). Host A requires approval (gateway.nodes.pairing.autoApproveLocal=false); joining B runs the real CLI:
// `branch graft join`, then `branch graft --host` over stdio. Two engine starts do not fit CI's 15-minute cap, so
// it runs locally when BRANCH_SCRATCH_ENGINE_DIR names a built engine (branch.mjs + dist), e.g. this worktree's.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayClient } from "../gateway/client.js";
import { freePort, markSetupDone, scratchEngineEnv } from "./ui-target.js";

const engineDir = process.env.BRANCH_SCRATCH_ENGINE_DIR ?? "";
const run = promisify(execFile);
type Engine = { url: string; token: string; env: NodeJS.ProcessEnv; child: ChildProcess };

async function startEngine(root: string, name: string, approveLocal: boolean): Promise<Engine> {
  const scratch = fs.mkdtempSync(path.join(root, `${name}-`));
  markSetupDone(scratch);
  const file = path.join(scratch, "home", ".branch", "branch.json");
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!approveLocal) cfg.gateway.nodes = { pairing: { autoApproveLocal: false } };
  fs.writeFileSync(file, JSON.stringify(cfg));
  const port = await freePort();
  const token = randomBytes(24).toString("hex");
  // The engines and CLIs run as they would outside the test runner (no VITEST/test-mode env).
  const outside = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(VITEST|NODE_ENV$|BRANCH_TEST_)/.test(key)),
  );
  const env = scratchEngineEnv(scratch, port, token, outside);
  const log = fs.openSync(path.join(scratch, "gateway.log"), "a");
  const child = spawn(process.execPath, ["branch.mjs", "gateway", "--dev", "--port", `${port}`], {
    cwd: engineDir,
    env,
    windowsHide: true,
    stdio: ["ignore", log, log],
  });
  for (let deadline = Date.now() + 300_000; Date.now() < deadline;) {
    if (
      await fetch(`http://127.0.0.1:${port}/readyz`).then(
        (r) => r.ok,
        () => false,
      )
    ) {
      return { url: `ws://127.0.0.1:${port}`, token, env, child };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${name} did not become ready`);
}

const ownerCall =
  (e: Engine) =>
  async (method: string, params: Record<string, unknown> = {}) =>
    await new Promise<any>((resolve, reject) => {
      const client = new GatewayClient({
        url: e.url,
        token: e.token,
        deviceIdentity: null,
        requestTimeoutMs: 240_000,
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.pairing"],
        onHelloOk: () => {
          client
            .request(method, params)
            .then(resolve, reject)
            .finally(() => client.stop());
        },
        onConnectError: reject,
      });
      client.start();
    });

const cli = (e: Engine, args: string[]) =>
  run(process.execPath, ["branch.mjs", ...args], { cwd: engineDir, env: e.env, windowsHide: true });

describe.runIf(Boolean(engineDir))("Branch-to-Branch with two scratch engines", () => {
  let root = "";
  let A: Engine;
  let B: Engine;
  let mcp: Client | undefined;
  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(process.env.BRANCH_UI_TEST_ROOT ?? os.tmpdir(), "graft-b2b-"));
    [A, B] = await Promise.all([startEngine(root, "host", false), startEngine(root, "join", true)]);
  }, 600_000);
  afterAll(async () => {
    await mcp?.close().catch(() => undefined);
    for (const engine of [A, B]) {
      if (engine?.child.pid)
        await run("taskkill", ["/PID", `${engine.child.pid}`, "/T", "/F"]).catch(() => undefined);
    }
  });

  it("joins after approval, lists B and its Trunks on A, attributes B's message, and Disconnect removes it", async () => {
    const callA = ownerCall(A);
    await ownerCall(B)("agents.create", { name: "Scout" });
    const invite = await callA("device.pair.setupCode", { publicUrl: A.url, includeQr: false });
    const join = cli(B, ["graft", "join", invite.setupCode, "--name", "Branch B"]);
    let pending: { requestId: string; scopes: string[] } | undefined;
    for (let i = 0; i < 120 && !pending; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      pending = (await callA("device.pair.list")).pending?.[0];
    }
    expect(pending?.scopes).toEqual(["operator.read", "operator.write"]);
    await callA("device.pair.approve", { requestId: pending!.requestId });
    const joined = await join;
    expect(`${joined.stdout}${joined.stderr}`).toContain("Grafted into");

    const rows = (await callA("contacts.outside.list")).agents as {
      id: string;
      kind?: string;
      via?: string;
    }[];
    expect(rows.map((row) => [row.id, row.kind, row.via]).toSorted()).toEqual([
      ["branch-b", "branch", undefined],
      ["branch-b--main", "trunk", "branch-b"],
      ["branch-b--scout", "trunk", "branch-b"],
    ]);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["branch.mjs", "graft", "--host", A.url],
      cwd: engineDir,
      env: B.env as Record<string, string>,
      stderr: "pipe",
    });
    mcp = new Client({ name: "claude-code", title: "Claude Code", version: "test" });
    await mcp.connect(transport);
    const sent: any = await mcp.callTool(
      { name: "trunk_send", arguments: { agent_id: "main", text: "Hello from Branch B" } },
      undefined,
      { timeout: 180_000 },
    );
    expect(sent.isError).toBeFalsy();
    const history = await callA("chat.history", {
      sessionKey: sent.structuredContent.thread_key ?? sent.structuredContent.threadKey,
      limit: 10,
    });
    const turn = [
      ...history.messages,
      ...(history.pendingInputs?.items ?? []).map((i: any) => i.message),
    ].find((m: any) => m?.role === "user");
    expect(turn.__branch).toMatchObject({
      senderName: "Branch B",
      senderIdentity: { id: "branch-b", pluginId: "a2a" },
    });

    await callA("contacts.outside.set", { id: "branch-b", revoked: true });
    expect((await callA("device.pair.list")).paired).toEqual([]);
    const after: any = await mcp.callTool({ name: "trunks_list", arguments: {} });
    expect(after.isError).toBe(true);
  }, 900_000);
});
