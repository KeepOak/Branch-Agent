import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePluginActivationStateShared } from "../plugins/config-activation-shared.js";
import { normalizePluginsConfig } from "../plugins/config-state.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";
import { clearTranscriptCapturesForTest } from "../transcripts/capture.test-support.js";
import { getTranscriptLibrary, listTranscriptLibrary } from "../transcripts/library.js";
import { TranscriptsStore } from "../transcripts/store.js";
import type { MeetingSessionRecord } from "./session-types.js";
import { createMeetingDurableTranscriptBridge } from "./transcripts-bridge.runtime.js";

let stateDir: string | undefined;

afterEach(async () => {
  await clearTranscriptCapturesForTest();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
  if (stateDir) {
    await fs.rm(stateDir, { force: true, recursive: true });
  }
  stateDir = undefined;
});

function session(): MeetingSessionRecord<"chrome", "transcribe"> {
  return {
    id: "huddle-1",
    url: "https://app.slack.com/huddle/T0123ABCD/C0123ABCD",
    transport: "chrome",
    mode: "transcribe",
    agentId: "birch",
    state: "active",
    createdAt: "2026-10-15T15:00:00.000Z",
    updatedAt: "2026-10-15T15:00:00.000Z",
    participantIdentity: "Slack user",
    realtime: { enabled: false, toolPolicy: "none" },
    notes: [],
  };
}

function huddleEntry(on: boolean) {
  return { enabled: on, config: { enabled: on } };
}

describe("Slack huddles config", () => {
  it("keeps the plugin off until Join huddles saves the entry", () => {
    const state = (entries: Record<string, unknown>) =>
      resolvePluginActivationStateShared({
        id: "slack-huddles",
        origin: "workspace",
        config: normalizePluginsConfig({ entries }),
        enabledByDefault: false,
      });
    expect(state({}).enabled).toBe(false);
    expect(state({ "slack-huddles": huddleEntry(false) })).toMatchObject({
      enabled: false,
      source: "disabled",
    });
    expect(state({ "slack-huddles": huddleEntry(true) })).toMatchObject({
      enabled: true,
      explicitlyEnabled: true,
    });
  });
});

it("stores a Slack huddle transcript as a meeting note", async () => {
  stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-slack-huddle-"));
  const current = session();
  const bridge = createMeetingDurableTranscriptBridge({
    logger: { warn: () => undefined },
    options: { providerId: "slack-huddle", providerName: "Slack huddle", stateDir },
  });
  await bridge.start(current, async () => undefined);
  await bridge.ingest(current, [{ speaker: "Avery", text: "We will ship the notes." }]);
  await bridge.stop(current, async () => undefined);

  const store = new TranscriptsStore(path.join(stateDir, "transcripts"), {
    env: { ...process.env, BRANCH_STATE_DIR: stateDir },
  });
  const listed = await listTranscriptLibrary(store, {}, (id) =>
    id === "slack-huddle" ? "Slack huddle" : undefined,
  );
  expect(listed.sessions).toHaveLength(1);
  const meeting = listed.sessions[0];
  expect(meeting).toMatchObject({
    title: "Slack huddle meeting",
    providerId: "slack-huddle",
    providerName: "Slack huddle",
    overview: "We will ship the notes.",
  });
  if (!meeting) {
    throw new Error("Slack huddle transcript was not stored");
  }
  const notes = await getTranscriptLibrary(
    store,
    { selector: meeting.selector, includeUtterances: true },
    (id) => (id === "slack-huddle" ? "Slack huddle" : undefined),
  );
  expect(notes.summary).toMatchObject({
    overview: "We will ship the notes.",
    decisions: ["Avery: We will ship the notes."],
  });
  expect(notes.utterances?.[0]).toMatchObject({ speakerLabel: "Avery", text: "We will ship the notes." });
});
