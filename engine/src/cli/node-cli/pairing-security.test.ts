import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodePairingSetupCode } from "../../pairing/setup-code.js";
import { registerNodeCli } from "./register.js";

type LoadNodeHostConfig = typeof import("../../node-host/config.js").loadNodeHostConfig;

const daemonMocks = vi.hoisted(() => ({
  defaultRuntime: {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  },
  loadNodeHostConfig: vi.fn<LoadNodeHostConfig>(async () => null),
  runNodeHost: vi.fn(),
}));

vi.mock("./daemon.js", () => daemonMocks);

vi.mock("../../node-host/config.js", () => ({
  loadNodeHostConfig: daemonMocks.loadNodeHostConfig,
}));

vi.mock("../../node-host/runner.js", () => ({
  runNodeHost: daemonMocks.runNodeHost,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: daemonMocks.defaultRuntime,
}));

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerNodeCli(program);
  return program;
}

const run = (args: string[]) => createProgram().parseAsync(["node", ...args], { from: "user" });
const pairCode = () =>
  encodePairingSetupCode({
    url: "wss://gateway.example:8443/branch-gw",
    bootstrapToken: "bootstrap-123",
    tlsFingerprint: `sha256:${"ab".repeat(32)}`,
  });

describe("branch node run pairing input", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    daemonMocks.loadNodeHostConfig.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function writeCodeFile(mode: number, contents: string) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-pair-test-"));
    const filePath = path.join(tempDir, "code.txt");
    fs.writeFileSync(filePath, contents, { mode });
    fs.chmodSync(filePath, mode);
    return filePath;
  }

  it("warns when using deprecated --pair <code> form without echoing the code", async () => {
    const code = pairCode();
    await run(["run", "--pair", code]);
    expect(daemonMocks.defaultRuntime.log).toHaveBeenCalledWith(
      expect.stringContaining("deprecated and insecure"),
    );
    expect(daemonMocks.defaultRuntime.log.mock.calls.flat().join("\n")).not.toContain(code);
    expect(daemonMocks.runNodeHost).toHaveBeenCalled();
  });

  it("accepts --pair-file without a deprecation warning", async () => {
    const code = pairCode();
    const filePath = writeCodeFile(0o600, code);
    await run(["run", "--pair-file", filePath]);
    expect(daemonMocks.defaultRuntime.log).not.toHaveBeenCalledWith(
      expect.stringContaining("deprecated and insecure"),
    );
    expect(daemonMocks.defaultRuntime.error).not.toHaveBeenCalledWith(
      expect.stringContaining("unsafe permissions"),
    );
    expect(daemonMocks.runNodeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayBootstrapToken: "bootstrap-123",
        preferGatewayBootstrapToken: true,
      }),
    );
  });

  it.skipIf(os.platform() === "win32")(
    "rejects --pair-file with unsafe permissions on POSIX",
    async () => {
      const filePath = writeCodeFile(0o644, pairCode());
      await run(["run", "--pair-file", filePath]);
      expect(daemonMocks.defaultRuntime.error).toHaveBeenCalledWith(
        expect.stringContaining("unsafe permissions"),
      );
      expect(daemonMocks.runNodeHost).not.toHaveBeenCalled();
    },
  );

  it("accepts --pair-if-needed-file without a deprecation warning", async () => {
    const filePath = writeCodeFile(0o600, pairCode());
    await run(["run", "--pair-if-needed-file", filePath]);
    expect(daemonMocks.defaultRuntime.log).not.toHaveBeenCalledWith(
      expect.stringContaining("deprecated and insecure"),
    );
    expect(daemonMocks.runNodeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayBootstrapToken: "bootstrap-123",
        preferGatewayBootstrapToken: false,
      }),
    );
  });

  it("warns when using deprecated --pair-if-needed <code> form", async () => {
    await run(["run", "--pair-if-needed", pairCode()]);
    expect(daemonMocks.defaultRuntime.log).toHaveBeenCalledWith(
      expect.stringContaining("deprecated and insecure"),
    );
    expect(daemonMocks.runNodeHost).toHaveBeenCalled();
  });

  it("warns that BRANCH_PAIRING_CODE is visible to same-user processes", async () => {
    vi.stubEnv("BRANCH_PAIRING_CODE", pairCode());
    await run(["run"]);
    expect(daemonMocks.defaultRuntime.log).toHaveBeenCalledWith(
      expect.stringContaining("visible to same-user processes"),
    );
    expect(daemonMocks.runNodeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayBootstrapToken: "bootstrap-123",
        preferGatewayBootstrapToken: true,
      }),
    );
  });

  it("keeps if-needed mode when BRANCH_PAIRING_CODE is set with --pair-if-needed-file", async () => {
    vi.stubEnv("BRANCH_PAIRING_CODE", pairCode());
    const filePath = writeCodeFile(0o600, pairCode());
    await run(["run", "--pair-if-needed-file", filePath]);
    expect(daemonMocks.runNodeHost).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayBootstrapToken: "bootstrap-123",
        preferGatewayBootstrapToken: false,
      }),
    );
  });

  it.each([
    ["--pair", "forced-code", "--pair-if-needed-file", "if-needed.txt"],
    ["--pair-file", "forced.txt", "--pair-if-needed", "if-needed-code"],
    ["--pair-file", "forced.txt", "--pair-if-needed-file", "if-needed.txt"],
  ])(
    "rejects mixed forced and if-needed pairing: %s with %s",
    async (forcedFlag, forcedValue, ifNeededFlag, ifNeededValue) => {
      await expect(
        run(["run", forcedFlag, forcedValue, ifNeededFlag, ifNeededValue]),
      ).rejects.toMatchObject({ code: "commander.conflictingOption" });
      expect(daemonMocks.runNodeHost).not.toHaveBeenCalled();
      expect(daemonMocks.loadNodeHostConfig).not.toHaveBeenCalled();
    },
  );
});
