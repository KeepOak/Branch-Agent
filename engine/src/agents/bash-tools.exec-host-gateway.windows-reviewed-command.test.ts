import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteCliArg } from "../cli/quote-cli-arg.js";
import { buildEnforcedShellCommand } from "../infra/exec-approvals-analysis.js";
import { evaluateShellAllowlistWithAuthorization } from "../infra/exec-approvals.js";
import type { ExecAutoReviewDecision } from "../infra/exec-auto-review.js";

const { host, commit, humanRequest, gateway } = vi.hoisted(() => ({
  host: vi.fn(),
  commit: vi.fn(async () => () => {}),
  humanRequest: vi.fn(() => {
    throw new Error("Source fixture reached unexpected human transport");
  }),
  gateway: vi.fn(() => {
    throw new Error("Source fixture reached unexpected gateway transport");
  }),
}));
vi.mock("./bash-tools.exec-host-shared.js", async (original) => ({
  ...(await original<typeof import("./bash-tools.exec-host-shared.js")>()),
  resolveExecHostApprovalContext: host,
  createExecApprovalRequestRoute: humanRequest,
}));
vi.mock("./tools/gateway.js", async (original) => ({
  ...(await original<typeof import("./tools/gateway.js")>()),
  callGatewayTool: gateway,
}));
vi.mock("../infra/exec-approvals.js", async (original) => ({
  ...(await original<typeof import("../infra/exec-approvals.js")>()),
  commitExecAuthorizationLocked: commit,
}));
import { processGatewayAllowlist } from "./bash-tools.exec-host-gateway.js";

const ownedDirs: string[] = [];
afterEach(() => {
  for (const directory of ownedDirs.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});

function fixture() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "branch-reviewed-native-")));
  ownedDirs.push(cwd);
  const executable = path.join(cwd, process.platform === "win32" ? "node.exe" : "node");
  fs.copyFileSync(process.execPath, executable);
  fs.chmodSync(executable, 0o755);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = `${cwd}${path.delimiter}${process.env.PATH ?? ""}`;
  const script = "process.stdout.write('fixture')";
  const command =
    process.platform === "win32"
      ? `node.exe -e "${script}"`
      : `${quoteCliArg(executable)} -e ${quoteCliArg(script)}`;
  return { cwd, executable, env, command };
}

function params(value: ReturnType<typeof fixture>) {
  return {
    command: value.command,
    workdir: value.cwd,
    env: value.env as Record<string, string>,
    security: "full" as const,
    ask: "on-miss" as const,
    autoReview: true,
    strictInlineEval: true,
    pty: false,
    defaultTimeoutSec: 30,
    safeBins: new Set<string>(),
    safeBinProfiles: {},
    warnings: [] as string[],
    approvalRunningNoticeMs: 0,
    maxOutput: 1000,
    pendingMaxOutput: 1000,
  };
}

function fullPolicy(ask: "off" | "on-miss") {
  host.mockReturnValue({
    approvals: { allowlist: [], file: { version: 1, agents: {} } },
    hostSecurity: "full",
    hostAsk: ask,
    askFallback: "full",
  });
}

describe("native reviewed command through the source gateway caller", () => {
  it("reviews an explicit inline-eval requirement under full policy and rejects changed executable bytes", async () => {
    const value = fixture();
    fullPolicy("on-miss");
    const autoReviewer = vi.fn(async (): Promise<ExecAutoReviewDecision> => ({
      decision: "allow-once",
      risk: "low",
      rationale: "fixture review",
    }));
    const result = await processGatewayAllowlist({ ...params(value), autoReviewer });
    expect(autoReviewer).toHaveBeenCalledOnce();
    expect(result.deniedResult).toBeUndefined();
    expect(humanRequest).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: expect.objectContaining({ source: "auto-review" }),
      }),
    );
    expect(result.execCommandOverride).toBeTypeOf("string");
    if (process.platform === "win32") {
      const evaluation = await evaluateShellAllowlistWithAuthorization({
        command: value.command,
        cwd: value.cwd,
        env: value.env,
        platform: process.platform,
        allowlist: [],
        safeBins: new Set(),
        safeBinProfiles: {},
      });
      const enforced = buildEnforcedShellCommand({
        command: value.command,
        segments: evaluation.segments,
        platform: process.platform,
      });
      expect(enforced.ok).toBe(true);
      expect(result.execCommandOverride).toBe(enforced.command);
    }
    await expect(result.revalidateBeforeExecution?.()).resolves.toBeUndefined();
    fs.appendFileSync(value.executable, Buffer.from([0]));
    const denied = await result.revalidateBeforeExecution?.();
    expect(denied?.details.status).toBe("failed");
    expect(denied?.content[0]).toMatchObject({
      text: expect.stringContaining("operand changed before execution"),
    });
  });

  it("does not commit a command whose executable changes during review", async () => {
    const value = fixture();
    fullPolicy("on-miss");
    const autoReviewer = vi.fn(async (): Promise<ExecAutoReviewDecision> => {
      fs.appendFileSync(value.executable, Buffer.from([0]));
      return { decision: "allow-once", risk: "low", rationale: "fixture review" };
    });
    const result = await processGatewayAllowlist({ ...params(value), autoReviewer });
    expect(autoReviewer).toHaveBeenCalledOnce();
    expect(result.deniedResult?.details.status).toBe("failed");
    expect(result.deniedResult?.content[0]).toMatchObject({
      text: expect.stringContaining("operand changed before execution"),
    });
    expect(result.execCommandOverride).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    expect(humanRequest).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
  });

  it("keeps normal Full Access direct without a reviewer or extra approval", async () => {
    const value = fixture();
    fullPolicy("off");
    const autoReviewer = vi.fn();
    const result = await processGatewayAllowlist({
      ...params(value),
      autoReview: false,
      strictInlineEval: false,
      ask: "off",
      autoReviewer,
    });
    expect(result.deniedResult).toBeUndefined();
    expect(autoReviewer).not.toHaveBeenCalled();
    expect(humanRequest).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization: expect.objectContaining({ source: "current-policy" }),
      }),
    );
  });
});
