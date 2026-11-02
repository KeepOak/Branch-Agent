import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { describe, expect, it } from "vitest";
import plugin, { slackHuddlesPlugin } from "../index.js";

const HUDDLE_URL = "https://app.slack.com/huddle/T0123ABCD/C0123ABCD";

function entry(on: boolean) {
  return { enabled: on, config: { enabled: on } };
}

async function join(pluginConfig: { enabled: boolean }) {
  const methods = new Map<string, (request: {
    params?: Record<string, unknown>;
    respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
  }) => Promise<void>>();
  plugin.register(
    createTestPluginApi({
      id: "slack-huddles",
      name: "Slack huddles",
      pluginConfig,
      registerGatewayMethod: (method, handler) => {
        methods.set(method, handler as (request: {
          params?: Record<string, unknown>;
          respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
        }) => Promise<void>);
      },
    }),
  );
  const handler = methods.get("slackhuddles.join");
  if (!handler) {
    throw new Error("slackhuddles.join was not registered");
  }
  let response: { ok: boolean; payload?: unknown; error?: unknown } | undefined;
  await handler({
    params: { mode: "transcribe", url: HUDDLE_URL },
    respond: (ok, payload, error) => {
      response = { ok, payload, error };
    },
  });
  return response;
}

describe("Slack huddles join gate", () => {
  it("refuses join while the plugin config is off", async () => {
    expect(slackHuddlesPlugin.config.resolveConfig(entry(false).config).enabled).toBe(false);
    expect(slackHuddlesPlugin.config.resolveConfig(entry(true).config).enabled).toBe(true);

    const refused = await join({ enabled: false });
    expect(refused?.ok).toBe(false);
    expect(JSON.stringify(refused)).toContain("Slack huddles plugin disabled in plugin config");
  });
});
