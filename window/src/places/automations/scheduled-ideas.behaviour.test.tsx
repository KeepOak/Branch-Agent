// Written by Branch for atlas UI-DESKTOP-0164 / R-2761 and DESIGN-SPEC §4.6.3.1 (idea15). The model-proposed follow-up foundation comes from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:src/tui/tui-task-suggestions.ts.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { dismiss, getToasts } from "../../shell/notify";
import { ScheduledTab } from "./Scheduled";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  for (const toast of getToasts()) dismiss(toast.id);
});

async function mount(scopes = ["operator.admin"]) {
  const responses: Record<string, unknown> = {
    "cron.list": { jobs: [], hasMore: false },
    "cron.status": { enabled: true },
    "cron.runs": { entries: [], hasMore: false },
    "agents.list": { defaultId: "main", agents: [] },
  };
  const request = vi.fn(async (method: string) => responses[method] ?? {});
  const engine: WindowEngine = {
    request: request as WindowEngine["request"],
    onEvent: () => () => {},
    sessionKey: "agent:main:main",
    agentId: "main",
    scopes,
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<ScheduledTab engine={engine} level="regular" openConversation={() => {}} />));
  return { host, request };
}

describe("UI-DESKTOP-0164 automation idea action", () => {
  it("R-2761: fills the describe box and waits for Add before proposing or saving", async () => {
    const { host, request } = await mount();
    const idea = host.querySelector<HTMLButtonElement>(".au-idea")!;
    const sentence = idea.querySelector("span")!.textContent;
    await act(async () => idea.click());
    const input = host.querySelector<HTMLInputElement>("[aria-label='Describe a new automation']")!;
    expect(input.value).toBe(sentence);
    expect(getToasts().at(-1)?.text).toBe("Filled in. Change anything, then Add.");
    expect(host.textContent).not.toContain("Not saved yet");
    expect(request.mock.calls.some(([method]) => method === "cron.add")).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>(".au-describe button")!.click());
    expect(host.textContent).toContain("Not saved yet");
    expect(host.querySelector<HTMLInputElement>("[aria-label='It does']")?.value).toBe(sentence);
    expect(request.mock.calls.some(([method]) => method === "cron.add")).toBe(false);
  });

  it("keeps idea actions disabled for a read-only operator", async () => {
    const { host, request } = await mount(["operator.read"]);
    const idea = host.querySelector<HTMLButtonElement>(".au-idea")!;
    expect(idea.disabled).toBe(true);
    await act(async () => idea.click());
    expect(host.querySelector<HTMLInputElement>("[aria-label='Describe a new automation']")!.value).toBe("");
    expect(getToasts()).toEqual([]);
    expect(request.mock.calls.some(([method]) => method === "cron.add")).toBe(false);
  });
});
