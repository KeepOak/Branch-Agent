// From openclaw/openclaw@785548984b28147f15cc792174ba7a6e32802ca9:src/infra/voicewake-routing.test.ts (atlas VOICE-0085). Changed for Branch: retain pinned normalization tests alongside current upstream persisted-route tests; all assertions retained.
// Covers voice wake routing normalization and resolution.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readConfigMachineState } from "../state/config-machine-state.js";
import {
  loadVoiceWakeRoutingConfig,
  normalizeVoiceWakeRoutingConfig,
  resolveVoiceWakeRouteByTrigger,
} from "./voicewake-routing.js";

vi.mock("../state/config-machine-state.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/config-machine-state.js")>()),
  readConfigMachineState: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(readConfigMachineState).mockReset();
});

describe("voicewake routing normalization", () => {
  it("normalizes agentId targets before persisting routes", () => {
    const normalized = normalizeVoiceWakeRoutingConfig({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Wake", target: { agentId: " Main Agent " } }],
    });
    expect(normalized.routes).toHaveLength(1);
    expect(normalized.routes[0]?.target).toEqual({ agentId: "main-agent" });
  });

  it("resolves trigger routing with punctuation-insensitive trigger values", () => {
    const config = normalizeVoiceWakeRoutingConfig({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Hey, Bot", target: { sessionKey: "agent:main:voice" } }],
    });
    expect(resolveVoiceWakeRouteByTrigger({ trigger: "hey bot", config })).toEqual({
      sessionKey: "agent:main:voice",
    });
  });
});

describe("voicewake persisted routing normalization", () => {
  it("normalizes agentId targets from persisted routes", async () => {
    vi.mocked(readConfigMachineState).mockReturnValue({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Wake", target: { agentId: " Main Agent " } }],
    });
    const normalized = await loadVoiceWakeRoutingConfig();
    expect(normalized.routes).toHaveLength(1);
    expect(normalized.routes[0]?.target).toEqual({ agentId: "main-agent" });
  });

  it("resolves trigger routing with punctuation-insensitive trigger values", async () => {
    vi.mocked(readConfigMachineState).mockReturnValue({
      defaultTarget: { mode: "current" },
      routes: [{ trigger: "Hey, Bot", target: { sessionKey: "agent:main:voice" } }],
    });
    const config = await loadVoiceWakeRoutingConfig();
    expect(resolveVoiceWakeRouteByTrigger({ trigger: "hey bot", config })).toEqual({
      sessionKey: "agent:main:voice",
    });
  });
});
