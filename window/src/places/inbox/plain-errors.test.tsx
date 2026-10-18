// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { getToasts, dismiss } from "../../shell/notify";
import { InboxPlace } from "./index";
import { NeedsYou } from "./NeedsYou";
import { Inspect } from "./Inspect";
import { Every } from "./Every";
import { StatusCard } from "./Rows";
import { Failure } from "../automations/Failure";
import { loadNeeds, usePlaceData } from "./data";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
const RAW = "unknown method: logbook.status";
const PLAIN = "This part of Branch isn’t ready on this computer yet. Update Branch, then try again.";
const noop = () => {};
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; localStorage.clear(); getToasts().forEach(t => dismiss(t.id)); });
function engine(values: Record<string, unknown> = {}, reject = false): WindowEngine {
  return { scopes: ["operator.admin"], sessionKey: null, onEvent: () => noop, request: vi.fn(async (method: string) => { if (method in values) return values[method]; if (reject) throw new Error(RAW); return {}; }) as WindowEngine["request"] };
}
async function mount(node: ReactNode) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root!.render(node)); return host; }
function safe() { expect(document.body.textContent).toContain(PLAIN); expect(document.body.textContent).not.toContain(RAW); expect(document.querySelector("details")).toBeNull(); }
async function click(text: string) { const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); }

describe.each(["regular", "advanced"] as Level[])("plain inbox failures at %s", level => {
  it("index.tsx: partial Inbox reads and history errors", async () => {
    localStorage.setItem("branch.level", level);
    await mount(<InboxPlace engine={engine({}, true)} level={level} facts={{ running: 0, waiting: 0 }} openConversation={noop} openPlace={noop} />); safe();
    await click("History"); safe();
  });
  it("NeedsYou.tsx: channel and automation status cards", async () => {
    localStorage.setItem("branch.level", level);
    const e = engine({ "channels.status": { channelLabels: { telegram: "Telegram" }, channelAccounts: { telegram: [{ accountId: "default", configured: true, running: false, lastError: RAW }] } }, "cron.list": { jobs: [{ id: "job", name: "Morning brief", state: { lastRunStatus: "error", lastError: RAW } }] } });
    await mount(<NeedsYou data={await loadNeeds(e)} engine={e} level={level} busy={false} act={async () => true} loading={false} openConversation={noop} openPlace={noop} />); safe();
    expect(document.querySelectorAll(".ib-card").length).toBeGreaterThanOrEqual(2);
  });
  it("NeedsYou.tsx: full access request failure toast", async () => {
    localStorage.setItem("branch.level", level);
    const e = { ...engine(), scopes: ["operator.read"], requestScopeUpgrade: vi.fn(async () => { throw new Error(RAW); }) };
    await mount(<NeedsYou data={await loadNeeds(e)} engine={e} level={level} busy={false} act={async () => true} loading={false} openConversation={noop} openPlace={noop} />);
    await click("Ask for full access"); expect(getToasts().at(-1)?.text).toBe(PLAIN);
  });
  it("Rows.tsx: keeps failure feedback with the card text", async () => { localStorage.setItem("branch.level", level); await mount(<StatusCard icon="clock" title="Failed" sub="Morning brief" extra={<Failure error={RAW} level={level} />} />); safe(); expect(document.querySelector(".ib-grow")?.textContent).toContain(PLAIN); });
  it("data.ts: distinguishes failed actions from successful notices", async () => {
    localStorage.setItem("branch.level", level);
    const e = engine(); const load = async () => ({});
    function Actions() { const state = usePlaceData(e, load); return <><button onClick={() => void state.act(async () => { throw new Error("503"); }, "Saved")}>Fail</button><button onClick={() => void state.act(async () => ({}), "Answered")}>Answer</button><Failure error={state.notice} notice={!state.noticeIsError} level={level} /></>; }
    await mount(<Actions />); await click("Fail"); expect(document.body.textContent).not.toContain("503"); expect(document.body.textContent).toContain("That didn’t work. Try again."); await click("Answer"); expect(document.body.textContent).toContain("Answered"); expect(document.body.textContent).not.toContain(PLAIN);
  });
  it("Inspect.tsx: request failure", async () => {
    localStorage.setItem("branch.level", level); await mount(<Inspect engine={engine({}, true)} title="Morning brief" at={new Date()} runId="run" close={noop} />); safe();
  });
  it("Every.tsx: working copy request failure", async () => {
    localStorage.setItem("branch.level", level); await mount(<Every engine={engine({}, true)} data={{ sessions: [], runs: [], profiles: [], self: "", agents: { defaultId: "", list: [] }, errors: [] }} level={level} open={noop} />);
    await click("Working copies"); safe();
  });
});
