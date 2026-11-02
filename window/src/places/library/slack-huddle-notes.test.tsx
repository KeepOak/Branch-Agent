// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { MeetingsTab } from "./meetings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const iso = "2026-10-15T15:00:00.000Z";
const session = {
  selector: "slack-huddle-1",
  sessionId: "slack-huddle-1",
  title: "Slack huddle meeting",
  providerId: "slack-huddle",
  providerName: "Slack huddle",
  source: { providerId: "slack-huddle", kind: "live-caption", accountId: "grove" },
  startedAt: iso,
  active: false,
  utteranceCount: 1,
  overview: "We will ship the notes.",
  agentId: "a",
  updatedAt: iso,
  lastUtteranceAt: iso,
  participants: [],
  hasSummary: true,
};
const detail = {
  session,
  summary: {
    generatedAt: iso,
    overview: "We will ship the notes.",
    decisions: ["Avery: We will ship the notes."],
    actionItems: [],
    risks: [],
    participants: ["Avery"],
    source: "heuristic",
    utteranceCount: 1,
    markdown: "",
  },
  utterances: [{ sequence: 1, speakerLabel: "Avery", text: "We will ship the notes." }],
  nextCursor: null,
};

it("shows a Slack huddle transcript as a meeting note", async () => {
  const request = vi.fn(async (method: string) => method === "transcripts.list" ? { sessions: [session], nextCursor: null } : method === "transcripts.get" ? detail : {});
  const engine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: [] } as WindowEngine;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<MeetingsTab engine={engine} level="regular" trunks={[{ id: "a", identity: { name: "Birch" } }]} />); });
  await settle();
  await settle();
  expect(request).toHaveBeenCalledWith("transcripts.list", { limit: 50 });
  expect(host.textContent).toContain("Slack huddle meeting");
  expect(host.textContent).toContain("Slack huddle");
  expect(host.textContent).toContain("We will ship the notes.");
  const row = [...host.querySelectorAll(".lib-row")].find((item) => item.textContent?.includes("Slack huddle meeting"));
  const open = [...(row?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Open");
  await act(async () => { open!.click(); });
  await settle();
  await settle();
  expect(request).toHaveBeenCalledWith("transcripts.get", { selector: "slack-huddle-1", includeUtterances: true });
  const reader = host.querySelector('[data-testid="meeting-reader"]')!;
  expect(reader.textContent).toContain("We will ship the notes.");
  expect(reader.textContent).toContain("Avery: We will ship the notes.");
  await act(async () => { [...reader.querySelectorAll("button")].find((button) => button.textContent === "Transcript")!.click(); });
  expect(reader.textContent).toContain("Avery");
  expect(reader.textContent).toContain("We will ship the notes.");
});
