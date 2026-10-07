import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const HANDOFF_CHANNEL_ID = "p45-handoff-proof";

export async function createHandoffChannelPlugin(): Promise<{
  pluginDir: string;
  starts: () => Promise<number[]>;
  cleanup: () => Promise<void>;
}> {
  const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-p45-handoff-channel-"));
  const tracePath = path.join(pluginDir, "starts.jsonl");
  await fs.writeFile(
    path.join(pluginDir, "branch.plugin.json"),
    JSON.stringify({
      id: HANDOFF_CHANNEL_ID,
      activation: { onStartup: true },
      channels: [HANDOFF_CHANNEL_ID],
      configSchema: { type: "object", additionalProperties: false, properties: {} },
    }),
    "utf8",
  );
  await fs.writeFile(
    path.join(pluginDir, "index.cjs"),
    [
      'const fs = require("node:fs");',
      "module.exports = {",
      `  id: ${JSON.stringify(HANDOFF_CHANNEL_ID)},`,
      "  register(api) {",
      "    api.registerChannel({ plugin: {",
      `      id: ${JSON.stringify(HANDOFF_CHANNEL_ID)},`,
      "      meta: {",
      `        id: ${JSON.stringify(HANDOFF_CHANNEL_ID)},`,
      '        label: "P45 Handoff Proof",',
      '        selectionLabel: "P45 Handoff Proof",',
      '        docsPath: "/channels/p45-handoff-proof",',
      '        blurb: "Records channel starts across a real-engine handoff.",',
      "      },",
      '      capabilities: { chatTypes: ["direct"] },',
      "      config: {",
      '        listAccountIds: () => ["default"],',
      '        resolveAccount: (_cfg, accountId) => ({ accountId: accountId ?? "default" }),',
      "        isEnabled: () => true,",
      "        isConfigured: () => true,",
      "      },",
      "      gateway: {",
      "        async startAccount(ctx) {",
      `          fs.appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({ pid: process.pid }) + "\\n", "utf8");`,
      "          await new Promise((resolve) => {",
      "            if (ctx.abortSignal.aborted) resolve();",
      '            else ctx.abortSignal.addEventListener("abort", resolve, { once: true });',
      "          });",
      "        },",
      "      },",
      "    } });",
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  return {
    pluginDir,
    async starts() {
      const text = await fs.readFile(tracePath, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { pid: number }).pid);
    },
    cleanup: () => fs.rm(pluginDir, { recursive: true, force: true }),
  };
}
