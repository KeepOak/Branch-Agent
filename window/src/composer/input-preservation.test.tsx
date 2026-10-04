// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindUpdateLifecycle, type UpdateBridge } from "../connect/update-lifecycle";
import type { SaplingSession } from "../connect/session";
import { DockRow } from "./DockRow";
import { useDraft } from "./useDraft";
import { useWaitingLine, type Deliver } from "./useWaitingLine";
import { loadDraftSnapshot, saveDraft, saveDraftSnapshot, setInputPrivacy, type InputPrivacy } from "./drafts";
import { enqueue, loadLine, saveLine } from "./queue";
import { checkpointInputs, setUpdateBarrier } from "../connect/update-barrier";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let draft: ReturnType<typeof useDraft>;
let line: ReturnType<typeof useWaitingLine>;
const KEY = "agent:contact:main";
async function mount(key: string | null = KEY, deliver: Deliver = async () => {}, working = true, custody?: Parameters<typeof useWaitingLine>[4], privacy: InputPrivacy = "ordinary") {
  function Harness() { draft = useDraft(key, undefined, privacy); line = useWaitingLine(key, working, false, deliver, custody ?? { sessionId: "physical", privacy, read: async () => ({}) }); return <div>{draft.text}:{line.line.length}</div>; }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<Harness />));
}
async function unmount() { await act(async () => root?.unmount()); root = undefined; }
const PRIVATE = "agent:private:main";
const UNKNOWN = "agent:unclassified:main";
beforeEach(() => { setInputPrivacy(KEY, "ordinary"); setInputPrivacy("agent:other:main", "ordinary"); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of [KEY, PRIVATE, UNKNOWN]) { setInputPrivacy(key, "ordinary"); saveDraftSnapshot(localStorage, key, { text: "", files: [], people: [] }); saveLine(localStorage, key, []); }
  await unmount(); document.body.innerHTML = ""; setUpdateBarrier(false); vi.restoreAllMocks(); await checkpointInputs(); localStorage.clear(); });

describe("inputs survive a renderer reload without crossing contact conversations", () => {
  it("retains text, attachment bytes and identity, mentions, and compose updates", async () => {
    await mount();
    await act(async () => { draft.setText("@Alex keep this"); draft.addPerson({ profileId: "alex", name: "Alex" }); draft.addPastedText("attachment bytes"); });
    const before = draft.snapshot();
    await unmount();
    saveDraft(localStorage, KEY, "@Alex edited elsewhere");
    await mount();
    expect(draft.files).toEqual(before.files);
    expect(draft.people).toEqual(before.people);
    expect(draft.text).toBe("@Alex edited elsewhere");
    await unmount(); await mount("agent:other:main");
    expect(draft.snapshot()).toEqual({ text: "", files: [], people: [] });
  });
  it("does not clear newer typing when an earlier send is acknowledged", async () => {
    await mount();
    await act(async () => draft.setText("first")); const sent = draft.snapshot();
    await act(async () => { draft.setText("newer unsent"); draft.clearSent(sent); });
    expect(draft.text).toBe("newer unsent");
  });
  it("the update checkpoint waits for attachment reads and refuses a failed save", async () => {
    await mount();
    let finish!: (bytes: ArrayBuffer) => void;
    const file = new File([], "picked.txt", { type: "text/plain" });
    file.arrayBuffer = () => new Promise((resolve) => { finish = resolve; });
    let reading!: Promise<void>;
    await act(async () => { reading = draft.addFiles([file], "file"); });
    let saved = false;
    const checkpoint = checkpointInputs().then(() => { saved = true; });
    await Promise.resolve(); expect(saved).toBe(false);
    await act(async () => { finish(new TextEncoder().encode("actual bytes").buffer); await reading; await checkpoint; });
    expect(loadDraftSnapshot(localStorage, KEY).files[0].content).toBe(btoa("actual bytes"));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    await expect(checkpointInputs()).rejects.toThrow("quota");
  });
});

describe("waiting-line admission receipts", () => {
  it("holds the message and its order until ACK, with no second delivery during rerenders", async () => {
    let ack!: () => void;
    const deliver = vi.fn(() => new Promise<void>((resolve) => { ack = resolve; }));
    saveLine(localStorage, KEY, enqueue(enqueue([], { id: "stable-a", text: "first", files: [] }), { id: "stable-b", text: "second", files: [] }));
    await mount(KEY, deliver, false);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(loadLine(localStorage, KEY).map((i) => i.id)).toEqual(["stable-a", "stable-b"]);
    expect(line.line[0].state).toBe("sending");
    await act(async () => { setUpdateBarrier(true); ack(); });
    expect(line.line.map((i) => i.id)).toEqual(["stable-b"]);
    expect(deliver).toHaveBeenCalledTimes(1);
  });
  it("retains failed and ambiguous sends across reload, with the same admission identity", async () => {
    const deliver = vi.fn(async () => { throw new Error("lost ACK"); });
    saveLine(localStorage, KEY, enqueue([], { id: "stable", text: "first", files: [] }));
    await mount(KEY, deliver, false);
    expect(line.line).toMatchObject([{ id: "stable", state: "failed" }]);
    await unmount(); await mount(KEY, deliver, false);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(line.line[0].id).toBe("stable");
  });
  it("does not deliver or steer while an update is preparing, and cancel preserves order", async () => {
    setUpdateBarrier(true);
    const deliver = vi.fn(async () => {});
    saveLine(localStorage, KEY, enqueue(enqueue([], { id: "a", text: "first", files: [] }), { id: "b", text: "second", files: [] }));
    await mount(KEY, deliver, false);
    await act(async () => line.steerNow("b"));
    expect(deliver).not.toHaveBeenCalled();
    expect(line.line.map((i) => i.id)).toEqual(["a", "b"]);
    await act(async () => line.remove("a"));
    await checkpointInputs();
    expect(loadLine(localStorage, KEY).map((i) => i.id)).toEqual(["b"]);
  });
  it("reconciles exact durable custody across reload without replay, then retires consumed input", async () => {
    const deliver = vi.fn(async () => {});
    const read = vi.fn(async () => ({ sessionId: "physical", inputReceipts: [{ runId: "stable", state: "pending" }] }));
    saveLine(localStorage, KEY, [{ id: "stable", sessionId: "physical", text: "first", files: [], state: "sending", awaitingReceipt: true }]);
    await mount(KEY, deliver, false, { sessionId: "physical", read });
    expect(read).toHaveBeenCalledWith(["stable"]);
    expect(line.line[0].state).toBe("sending"); expect(deliver).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ sessionId: "physical", inputReceipts: [{ runId: "stable", state: "consumed" }] });
    await act(async () => { await line.reconcile(); });
    expect(line.line).toEqual([]); expect(deliver).not.toHaveBeenCalled();
  });
  it("keeps absent receipts unresolved and cannot consume an older physical session's item", async () => {
    const deliver = vi.fn(async () => {});
    const read = vi.fn(async () => ({ sessionId: "replacement", inputReceipts: [{ runId: "stable", state: "consumed" }] }));
    saveLine(localStorage, KEY, [{ id: "stable", sessionId: "original", text: "first", files: [], state: "sending", awaitingReceipt: true }]);
    await mount(KEY, deliver, false, { sessionId: "replacement", read });
    expect(line.line[0]).toMatchObject({ id: "stable", state: "failed", awaitingReceipt: true });
    await act(async () => line.retry("stable")); expect(deliver).not.toHaveBeenCalled();
    read.mockResolvedValueOnce({ sessionId: "original", inputReceipts: [] });
    await act(async () => { await line.reconcile(); });
    expect(line.line[0].awaitingReceipt).toBe(true); expect(deliver).not.toHaveBeenCalled();
    await act(async () => { line.reword("stable", "changed"); line.remove("stable"); line.steerNow("stable"); });
    expect(line.line[0].text).toBe("first"); expect(deliver).not.toHaveBeenCalled();
  });
  it("retains cancelled custody for the user without admitting another message", async () => {
    const deliver = vi.fn(async () => {});
    const read = vi.fn(async () => ({ sessionId: "physical", inputReceipts: [{ runId: "stable", state: "pending", cancelled: true }] }));
    saveLine(localStorage, KEY, [{ id: "stable", sessionId: "physical", text: "first", files: [], state: "sending", awaitingReceipt: true }]);
    await mount(KEY, deliver, false, { sessionId: "physical", read });
    expect(line.line[0]).toMatchObject({ id: "stable", state: "failed", awaitingReceipt: false });
    expect(deliver).not.toHaveBeenCalled();
  });

});


it("the real waiting-line controls identify and protect unresolved delivery", async () => {
  const retry = vi.fn(); const remove = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<DockRow trunkName="Contact" working={false} offline={false}
    line={[{ id: "stable", text: "kept", files: [], state: "failed", awaitingReceipt: true }]}
    onReword={vi.fn()} onMoveUp={vi.fn()} onRemove={remove} onSteerQueued={vi.fn()} onRetry={retry}
    jobs={[]} onStopJob={vi.fn()} goal={null} onGoal={vi.fn()} files={[]} preparing={0}
    onRemoveFile={vi.fn()} onShowText={vi.fn()} people={[]} onForget={vi.fn()} onSteer={async () => false} />));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="queue-chip"]')!.click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="Waiting message 1"]')!.disabled).toBe(true);
  const removeButton = document.querySelector<HTMLButtonElement>('[aria-label="Remove"]')!;
  expect(removeButton.disabled).toBe(true);
  await act(async () => removeButton.click()); expect(remove).not.toHaveBeenCalled();
  const check = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === "Check delivery")!;
  await act(async () => check.click()); expect(retry).toHaveBeenCalledWith("stable");
  expect(document.body.textContent).toContain("Delivery not confirmed");
});


it("keeps actual temporary draft attachments, mentions and queued text entirely in memory", async () => {
  const writes = vi.spyOn(Storage.prototype, "setItem");
  await mount(PRIVATE, async () => {}, true, undefined, "private");
  await act(async () => { draft.setText("@Alex private words"); draft.addPerson({ profileId: "alex", name: "Alex" }); draft.addPastedText("private attachment bytes"); line.add("private queued words", draft.files); });
  const kept = draft.snapshot();
  expect(writes).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  await expect(checkpointInputs()).rejects.toThrow("Temporary messages");
  expect(writes).not.toHaveBeenCalled();
  await unmount(); await mount(PRIVATE, async () => {}, true, undefined, "private");
  expect(draft.snapshot()).toEqual(kept);
  expect(line.line[0].text).toBe("private queued words");
});

it("does not persist unclassified input before the actual conversation privacy arrives", async () => {
  const writes = vi.spyOn(Storage.prototype, "setItem");
  await mount(UNKNOWN, async () => {}, true, undefined, "unknown");
  await act(async () => { draft.setText("unclassified text"); draft.addPastedText("unclassified bytes"); });
  expect(writes).not.toHaveBeenCalled();
  await expect(checkpointInputs()).rejects.toThrow("Temporary messages");
  expect(writes).not.toHaveBeenCalled();
  setInputPrivacy(UNKNOWN, "ordinary");
  await checkpointInputs();
  expect(localStorage.getItem("branch.composer.input:" + UNKNOWN)).toContain("unclassified bytes");
});

it("an unsent no-session draft also blocks disk checkpoints and automatic reload", async () => {
  const writes = vi.spyOn(Storage.prototype, "setItem");
  await mount(null, async () => {}, true, undefined, "private");
  await act(async () => { draft.setText("no-session private words"); draft.addPastedText("no-session bytes"); });
  await expect(checkpointInputs()).rejects.toThrow("Temporary messages");
  let prepare!: Parameters<NonNullable<UpdateBridge["onPrepareUpdate"]>>[0];
  const request = vi.fn(async () => ({}));
  const session = { getSnapshot: () => ({ sessionKey: null, status: { phase: "connected" } }), request } as unknown as SaplingSession;
  const unbind = bindUpdateLifecycle(session, { onPrepareUpdate: (fn) => { prepare = fn; return () => {}; } }, vi.fn());
  expect(await prepare({ operationId: "op", targetBuild: "build" })).toEqual({ status: "deferred", lifecycleGeneration: "op", targetBuild: "build" });
  expect(request).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled(); unbind();
});
