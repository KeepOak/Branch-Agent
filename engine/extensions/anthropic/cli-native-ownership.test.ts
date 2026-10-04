import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { probe } = vi.hoisted(() => ({ probe: vi.fn() }));
vi.mock("./cli-auth-seam.js", () => ({ probeClaudeCliAuthStatus: probe }));
import { buildAnthropicCliBackend } from "./cli-backend.js";
const directory = path.resolve("native-account-a");
const prepare = (extra: Record<string, unknown> = {}) =>
  buildAnthropicCliBackend().prepareExecution!({
    workspaceDir: path.resolve("workspace"),
    agentDir: path.resolve("agent"),
    provider: "claude-cli",
    modelId: "sonnet",
    executionMode: "agent",
    nativeConfigDir: directory,
    nativeCommand: "fixture-claude",
    ...extra,
  } as Parameters<NonNullable<ReturnType<typeof buildAnthropicCliBackend>["prepareExecution"]>>[0]);
beforeEach(() => {
  vi.unstubAllEnvs();
  for (const name of Object.keys(process.env)) {
    if (
      /^ANTHROPIC_/u.test(name) ||
      /^CLAUDE_CODE_(?:API_KEY|OAUTH|USE_BEDROCK|USE_VERTEX|USE_FOUNDRY)/u.test(name)
    )
      vi.stubEnv(name, undefined);
  }
  probe.mockReset().mockResolvedValue({
    status: "available",
    authMethod: "claude.ai",
    configDirectory: directory,
  });
});
describe("actual Claude backend native ownership prepare export", () => {
  it("probes selected subscription home and pins launch environment without credentials", async () => {
    const result = await prepare();
    expect(probe).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        command: "fixture-claude",
        env: expect.objectContaining({ CLAUDE_CONFIG_DIR: directory }),
      }),
    );
    expect(result?.env?.CLAUDE_CONFIG_DIR).toBe(directory);
    expect(result).not.toHaveProperty("secretInput");
  });
  it.each(["api_key", "api_key_helper", "oauth_token", "third_party", undefined])(
    "rejects non-subscription native auth %s",
    async (authMethod) => {
      probe.mockResolvedValue({ status: "available", authMethod, configDirectory: directory });
      await expect(prepare()).rejects.toThrow(/subscription login/);
    },
  );
  it.each([undefined, path.resolve("other-home")])(
    "requires exact native config directory attestation",
    async (configDirectory) => {
      probe.mockResolvedValue({ status: "available", authMethod: "claude.ai", configDirectory });
      await expect(prepare()).rejects.toThrow(/attest/);
    },
  );
  it.each(["missing", "unreadable"])("fails closed on %s native status", async (status) => {
    probe.mockResolvedValue({ status });
    await expect(prepare()).rejects.toThrow(/subscription/);
  });
  it("rejects Branch credential bridge before probe", async () => {
    await expect(
      prepare({ authCredential: { type: "api_key", key: "synthetic-fixture" } }),
    ).rejects.toThrow(/Branch credentials/);
    expect(probe).not.toHaveBeenCalled();
  });
  it.each(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK"])(
    "rejects %s launch overrides before probe",
    async (name) => {
      await expect(prepare({ nativeBackendEnv: { [name]: "synthetic-fixture" } })).rejects.toThrow(
        /environment overrides/,
      );
      expect(probe).not.toHaveBeenCalled();
    },
  );
  it("cancellation prevents auth probe", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepare({ nativeAbortSignal: controller.signal })).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
});
