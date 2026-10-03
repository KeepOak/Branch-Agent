import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as gatewayCall from "../gateway/call.js";
import { resolveRuntimeWorkerUrl } from "../infra/runtime-worker-url.js";
import { getFreePort } from "../test-utils/ports.js";
import { stateDirGatewayFixtureEntrypoint } from "./cli-entrypoint.test-support.js";
import { checkCliGatewayStateDir, type GatewayHello } from "./state-dir-gateway-check.js";

describe("state-dir guard with a real token Gateway", () => {
  const token = "state-dir-test-token";
  let child: ChildProcess;
  let root: string;
  let port: number;
  let gatewayStateDir: string;
  let cliStateDir: string;
  let hello: GatewayHello | undefined;

  const setCliStateDir = (stateDir: string) => {
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
    vi.stubEnv("BRANCH_CONFIG_PATH", path.join(stateDir, "branch.json"));
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "branch-state-dir-server-"));
    gatewayStateDir = path.join(root, "gateway");
    cliStateDir = path.join(root, "cli");
    await fs.mkdir(gatewayStateDir, { recursive: true });
    await fs.mkdir(cliStateDir, { recursive: true });
    port = await getFreePort();
    const gatewayConfigPath = path.join(gatewayStateDir, "branch.json");
    await fs.writeFile(
      gatewayConfigPath,
      `${JSON.stringify({ gateway: { mode: "local", port, auth: { mode: "token", token } } })}\n`,
    );
    const fixture = resolveRuntimeWorkerUrl(stateDirGatewayFixtureEntrypoint);
    // Standalone source runs retain the ESM-only preload; prepared JavaScript
    // must execute natively without installing a source transform hook.
    const execArgv = fixture.pathname.endsWith(".ts")
      ? ["--import", path.resolve("scripts/tsx.mjs")]
      : [];
    child = fork(fileURLToPath(fixture), [], {
      env: {
        ...process.env,
        HOME: path.join(root, "gateway-home"),
        BRANCH_STATE_DIR: gatewayStateDir,
        BRANCH_CONFIG_PATH: gatewayConfigPath,
        BRANCH_GATEWAY_PORT: String(port),
        BRANCH_TEST_GATEWAY_TOKEN: token,
        BRANCH_TEST_MINIMAL_GATEWAY: "1",
        BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
        BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
        BRANCH_SKIP_CANVAS_HOST: "1",
        BRANCH_SKIP_CHANNELS: "1",
        BRANCH_SKIP_CRON: "1",
        BRANCH_SKIP_GMAIL_WATCHER: "1",
        BRANCH_SKIP_PROVIDERS: "1",
      },
      execArgv,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let childStderr = "";
    child.stderr?.on("data", (chunk) => {
      childStderr += String(chunk);
    });
    await new Promise<void>((resolve, reject) => {
      child.once("message", () => {
        resolve();
      });
      child.once("exit", (code) => {
        reject(new Error(`Gateway fixture exited early: ${code}\n${childStderr}`));
      });
    });
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv("HOME", path.join(root, "cli-home"));
    setCliStateDir(cliStateDir);
    vi.stubEnv("BRANCH_GATEWAY_PORT", String(port));
    vi.stubEnv("BRANCH_SYSTEMD_UNIT", `branch-state-dir-server-${process.pid}`);
    hello = undefined;
    const callGateway = gatewayCall.callGateway;
    vi.spyOn(gatewayCall, "callGateway").mockImplementation((options) =>
      callGateway({
        ...options,
        onHelloOk(value) {
          hello = value;
          options.onHelloOk?.(value);
        },
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => {
        resolve();
      });
    });
    child.kill("SIGTERM");
    await exited;
    await fs.rm(root, { recursive: true, force: true });
  });

  it("allows matching authenticated hello paths", async () => {
    setCliStateDir(gatewayStateDir);
    await expect(
      checkCliGatewayStateDir({
        command: "branch channels add",
        config: { gateway: { mode: "local", port, auth: { mode: "token", token } } },
      }),
    ).resolves.toEqual({ kind: "allow" });
    expect(hello).toMatchObject({
      snapshot: {
        stateDir: gatewayStateDir,
        configPath: path.join(gatewayStateDir, "branch.json"),
      },
      auth: { scopes: expect.arrayContaining(["operator.admin"]) },
    });
  });

  it("refuses mismatched authenticated hello paths", async () => {
    const outcome = await checkCliGatewayStateDir({
      command: "branch channels add",
      config: { gateway: { mode: "local", port, auth: { mode: "token", token } } },
    });

    expect(outcome).toMatchObject({ kind: "refuse" });
    if (outcome.kind !== "refuse") {
      throw new Error("expected authenticated path mismatch refusal");
    }
    expect(outcome.message).toContain(gatewayStateDir);
    expect(outcome.message).toContain("live Gateway");
  });

  it("warns when a tokenless CLI can prove only the Gateway protocol", async () => {
    await expect(
      checkCliGatewayStateDir({
        command: "branch channels add",
        config: { gateway: { mode: "local", port, auth: { mode: "token" } } },
      }),
    ).resolves.toMatchObject({ kind: "warn" });
  });
});
