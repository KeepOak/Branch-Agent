// Mcp Channels Seed script supports Branch Agent repository automation.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyDockerOpenAiProviderConfig, type BranchConfig } from "./docker-openai-seed.ts";

async function main() {
  const stateDir = process.env.BRANCH_STATE_DIR?.trim() || path.join(os.homedir(), ".branch");
  const configPath =
    process.env.BRANCH_CONFIG_PATH?.trim() || path.join(stateDir, "branch.json");
  const now = Date.now();
  const frozenTarget = process.env.BRANCH_FROZEN_PLUGIN_PRERELEASE_FIXTURE_DIALECT === "legacy";

  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const seededConfig = applyDockerOpenAiProviderConfig(
    {
      gateway: {
        controlUi: {
          ...(frozenTarget ? { allowInsecureAuth: true } : {}),
          enabled: false,
        },
      },
      agents: {
        defaults: {
          heartbeat: {
            every: "0m",
          },
        },
      },
      plugins: {
        enabled: false,
      },
    } satisfies BranchConfig,
    "sk-docker-smoke-test",
  );

  await fs.writeFile(configPath, JSON.stringify(seededConfig, null, 2), "utf-8");

  if (frozenTarget) {
    const sessionsDir = path.join(stateDir, "agents", "main", "sessions");
    const sessionFile = path.join(sessionsDir, "sess-main.jsonl");
    const storePath = path.join(sessionsDir, "sessions.json");
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      storePath,
      JSON.stringify({
        "agent:main:main": {
          sessionId: "sess-main",
          sessionFile,
          updatedAt: now,
          deliveryContext: {
            channel: "imessage",
            to: "+15551234567",
            accountId: "imessage-default",
            threadId: "thread-42",
          },
          displayName: "Docker MCP Channel Smoke",
          derivedTitle: "Docker MCP Channel Smoke",
          lastMessagePreview: "seeded transcript",
        },
      }),
      "utf-8",
    );
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: "session", version: 1, id: "sess-main" }),
        JSON.stringify({
          id: "msg-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello from seeded transcript" }],
            timestamp: now,
          },
        }),
        JSON.stringify({
          id: "msg-attachment",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "seeded image attachment" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
            ],
            timestamp: now + 1,
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );
    process.stdout.write(
      `${JSON.stringify({ ok: true, stateDir, configPath, sessionFile, storePath })}\n`,
    );
    return;
  }

  const [
    { normalizeSessionDeliveryState, upsertSessionEntry },
    { appendSessionTranscriptMessagesByIdentity },
    { resolveBranchAgentSqlitePath },
  ] = await Promise.all([
    import("branch/plugin-sdk/session-store-runtime"),
    import("branch/plugin-sdk/session-transcript-runtime"),
    import("branch/plugin-sdk/sqlite-runtime"),
  ]);
  const storePath = resolveBranchAgentSqlitePath({ agentId: "main" });

  await upsertSessionEntry({
    agentId: "main",
    sessionKey: "agent:main:main",
    storePath,
    entry: {
      sessionId: "sess-main",
      updatedAt: now,
      delivery: normalizeSessionDeliveryState({
        context: {
          channel: "imessage",
          to: "+15551234567",
          accountId: "imessage-default",
          threadId: "thread-42",
        },
      }),
      displayName: "Docker MCP Channel Smoke",
    },
  });

  // The installed candidate owns the transcript header and ordered parent links.
  await appendSessionTranscriptMessagesByIdentity({
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "sess-main",
    storePath,
    config: seededConfig,
    messages: [
      {
        eventId: "msg-1",
        now,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello from seeded transcript" }],
          timestamp: now,
        },
      },
      {
        eventId: "msg-attachment",
        now: now + 1,
        message: {
          role: "user",
          content: "seeded image attachment",
          __branch: {
            media: [
              {
                url: "media://inbound/seeded-image.png",
                contentType: "image/png",
                kind: "image",
                fileName: "seeded-image.png",
                sizeBytes: 3,
              },
            ],
          },
          timestamp: now + 1,
        },
      },
    ],
  });

  process.stdout.write(`${JSON.stringify({ ok: true, stateDir, configPath, storePath })}\n`);
}

await main();
