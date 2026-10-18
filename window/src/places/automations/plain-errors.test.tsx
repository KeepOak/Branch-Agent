// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { getToasts, dismiss } from "../../shell/notify";
import { Failure } from "./Failure";
import { Checkins } from "./Checkins";
import { EmailTrigger } from "./EmailTrigger";
import { ProceduresTab } from "./Procedures";
import { Proposal } from "./Proposal";
import { JobRow } from "./Rows";
import { ScheduledTab } from "./Scheduled";
import { HowTheyreDoing } from "./Sections";
import { Sheet } from "./Sheet";
import { TriggersTab } from "./Triggers";
import { draftFromWords } from "./draft";
import { useAct } from "./act";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
const RAW = "unknown method: cron.list";
const PLAIN = "This part of Branch isn’t ready on this computer yet. Update Branch, then try again.";
const noop = () => {};
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); getToasts().forEach(t => dismiss(t.id)); });
function engine(values: Record<string, unknown> = {}): WindowEngine {
  return { connected: true, scopes: ["operator.admin"], sessionKey: null, onEvent: () => noop, request: vi.fn(async (method: string) => { if (method in values) return values[method]; throw new Error(RAW); }) as WindowEngine["request"] };
}
async function mount(node: ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}
function safe() { expect(document.body.textContent).toContain(PLAIN); expect(document.body.textContent).not.toContain(RAW); expect(document.querySelector("details")).toBeNull(); }
const job = { id: "job", name: "Morning brief", enabled: true, schedule: { kind: "every", everyMs: 60000 }, state: { lastRunStatus: "error", lastError: RAW, lastRunAtMs: Date.now() } };

describe.each(["regular", "advanced"] as Level[])("plain automation failures at %s", level => {
  it("Checkins.tsx: configuration read failures", async () => { localStorage.setItem("branch.level", level); await mount(<Checkins engine={engine()} level={level} />); safe(); });
  it("Checkins.tsx: heartbeat file failures", async () => { localStorage.setItem("branch.level", level); await mount(<Checkins engine={engine({ "config.get": { hash: "h", valid: true, config: {} }, "agents.list": { defaultId: "main", agents: [{ id: "main" }] }, "last-heartbeat": null })} level={level} />); safe(); });
  it("Checkins.tsx: failed heartbeat preview", async () => { localStorage.setItem("branch.level", level); await mount(<Checkins engine={engine({ "config.get": { hash: "h", valid: true, config: {} }, "agents.list": {}, "last-heartbeat": { ts: Date.now(), status: "failed", preview: RAW } })} level={level} />); safe(); });
  it("EmailTrigger.tsx: mailbox load failures", async () => { localStorage.setItem("branch.level", level); await mount(<EmailTrigger engine={engine()} trunks={[]} canWrite />); safe(); });
  it("Proposal.tsx: save failures", async () => { localStorage.setItem("branch.level", level); await mount(<Proposal draft={draftFromWords("every day check mail", "main")} change={noop} level={level} trunks={[]} models={[]} busy={false} canWrite error={RAW} onCancel={noop} onConfirm={noop} />); safe(); });
  it("Rows.tsx: last failed run", async () => { localStorage.setItem("branch.level", level); await mount(<JobRow job={job} trunk="Rowan" runs={[]} level={level} canWrite busy={false} actions={{ open: noop, toggle: noop, menu: noop }} />); safe(); });
  it("Scheduled.tsx: load failure", async () => { localStorage.setItem("branch.level", level); await mount(<ScheduledTab engine={engine()} level={level} openConversation={noop} />); safe(); });
  it("Sections.tsx: latest run failure", async () => { localStorage.setItem("branch.level", level); await mount(<HowTheyreDoing jobs={[job]} runs={new Map([["job", { entries: [{ status: "error", error: RAW }] }]])} />); safe(); });
  it("Sheet.tsx: runs load failure", async () => { localStorage.setItem("branch.level", level); await mount(<Sheet engine={engine()} job={job} level={level} trunks={[]} models={[]} canWrite busy={false} onClose={noop} save={async () => true} openConversation={noop} />); safe(); });
  it("Sheet.tsx: recorded run error and summary", async () => { localStorage.setItem("branch.level", level); await mount(<Sheet engine={engine({ "cron.runs": { entries: [{ status: "error", error: RAW, summary: RAW }] } })} job={job} level={level} trunks={[]} models={[]} canWrite busy={false} onClose={noop} save={async () => true} openConversation={noop} />); safe(); });
  it("Triggers.tsx: trigger and hook read failures", async () => { localStorage.setItem("branch.level", level); await mount(<TriggersTab engine={engine()} level={level} openConversation={noop} />); safe(); });
  it("act.ts: action failure toast", async () => {
    localStorage.setItem("branch.level", level);
    function Action() { const { run } = useAct(async () => {}); return <button onClick={() => void run(async () => { throw new Error(RAW); }, "Saved.")}>Save</button>; }
    const host = await mount(<Action />); await act(async () => host.querySelector("button")!.click());
    expect(getToasts().at(-1)?.text).toBe(PLAIN);
  });
});
it("Failure.tsx: only Technical includes original text behind closed Details", async () => { localStorage.setItem("branch.level", "technical"); await mount(<Failure error={RAW} />); const details = document.querySelector("details")!; expect(details.open).toBe(false); expect(details.querySelector("summary")?.textContent).toBe("Details"); expect(details.querySelector("pre")?.textContent).toBe(RAW); });
it("Failure.tsx: successful notices keep their wording", async () => { await mount(<Failure error="Answered" notice />); expect(document.body.textContent).toBe("Answered"); });
it("Procedures.tsx: technical commands load failure is disclosed, not the headline", async () => { localStorage.setItem("branch.level", "technical"); await mount(<ProceduresTab engine={engine()} level="technical" />); const alert = document.querySelector('[role="alert"]')!; expect(alert.textContent).toContain(PLAIN); expect(alert.querySelector("details pre")?.textContent).toBe(RAW); });

it("Sheet.tsx: successful run records preserve multiline text and indentation", async () => {
  const content = "Summary\n  indented detail\n\nNext step";
  const host = await mount(<Sheet engine={engine({
    "cron.runs": { entries: [{ runId: "successful-run", status: "ok" }] },
    "cron.history": { messages: [{ role: "user", content }, { role: "assistant", content }] },
  })} job={job} level="regular" trunks={[]} models={[]} canWrite busy={false} onClose={noop} save={async () => true} openConversation={noop} />);
  await act(async () => Array.from(host.querySelectorAll("button")).find(b => b.textContent === "See what it did")!.click());
  for (const role of ["user", "assistant"]) {
    // Paragraphs retain the existing .au-msg p pre-wrap and typography rules.
    expect(host.querySelector(`.au-msg.${role} > p`)?.textContent).toBe(content);
  }
  expect(host.querySelector("details")).toBeNull();
});
