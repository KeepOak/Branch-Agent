// @vitest-environment jsdom
// Library never crashes on a result that lacks the expected shape: every tab, at Regular and Technical.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { LibraryPlace } from "./index";
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
function engineOf(answer: (method: string) => unknown): WindowEngine {
  return { request: (async (method: string) => answer(method)) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: [] };
}
const ODD: Record<string, unknown> = {
  "agents.list": { agents: [{ id: "a" }, { name: "no id" }, null, 7] },
  "agents.files.get": { file: { content: 5 } },
  "doctor.memory.status": { embedding: null, rings: "on" },
  "config.get": { config: { agents: "x" } },
  "agents.workspace.list": { entries: [{ name: 1 }, null, { name: "a.md", path: "a.md", kind: "file" }], totalEntries: "many" },
  "sessions.list": { sessions: [{ key: "agent:a:x" }, { nokey: true }], hasMore: "yes" },
  "board.get": { widgets: [{}, "w"] },
  "artifacts.list": { artifacts: [{ id: "1", title: "f.md" }, { id: 2 }, { id: "3", title: "p.png", type: "image" }] },
  "transcripts.list": { sessions: [{ selector: "s" }, { title: "no selector" }] },
  "logbook.status": { captureEnabled: true },
  "logbook.days": { days: "none" },
  "logbook.timeline": { cards: [{ title: "Card" }, {}], stats: null },
};
async function walk(engine: WindowEngine, level: Level) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<LibraryPlace engine={engine} level={level} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={() => {}} />); });
  await settle();
  for (const tab of ["Memory", "Documents", "Meetings", "Activity"]) {
    const button = [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(b => b.textContent?.startsWith(tab))!;
    await act(async () => { button.click(); }); await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Library");
    expect(host.querySelector("[role=tab][aria-selected=true]")!.textContent).toContain(tab);
  }
  await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
}

describe("Library reads engine results defensively", () => {
  for (const level of ["regular", "technical"] as Level[]) {
    it(`renders every tab when every method returns {} (${level})`, async () => { await walk(engineOf(() => ({})), level); });
    it(`renders every tab with one Trunk and {} for everything else (${level})`, async () => { await walk(engineOf(m => (m === "agents.list" ? { agents: [{ id: "a" }] } : {})), level); });
    it(`renders every tab when fields have the wrong types (${level})`, async () => { await walk(engineOf(m => ODD[m] ?? {}), level); });
    it(`renders every tab when results are null (${level})`, async () => { await walk(engineOf(m => (m === "agents.list" ? { agents: [{ id: "a" }] } : null)), level); });
  }
});
