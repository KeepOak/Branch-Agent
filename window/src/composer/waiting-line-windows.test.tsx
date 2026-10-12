// @vitest-environment jsdom
// Two windows of one computer (a pop-out, or two tabs) share a conversation's waiting line: neither writes back a copy
// that drops the other's record, and a record one writes shows in the other.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadLine, type QueueItem } from "./queue";
import { useWaitingLine } from "./useWaitingLine";

const KEY = "agent:main:main";
let root: Root;
let line: ReturnType<typeof useWaitingLine> | null = null;
const seeLine = (current: ReturnType<typeof useWaitingLine>) => {
  line = current;
};

function Probe({ working, see = seeLine, deliver = () => undefined }: { working: boolean; see?: typeof seeLine; deliver?: (item: QueueItem) => void }) {
  see(useWaitingLine(KEY, working, false, deliver));
  return null;
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  line = null;
});

const checking: QueueItem = { id: "from-the-pop-out", text: "Sent from the other window", files: [], state: "checking", sentTo: { engine: "here|", at: 1, existed: true, owner: "pop-out" } };

/** Another window writes the stored line: this window hears it only through the browser's storage event. */
function otherWindowWrites(items: QueueItem[]): void {
  const raw = JSON.stringify(items);
  localStorage.setItem(`branch.composer.queue:${KEY}`, raw);
  window.dispatchEvent(new StorageEvent("storage", { key: `branch.composer.queue:${KEY}`, newValue: raw }));
}

describe("the waiting line across windows", () => {
  it("keeps another window's record when this window adds to the line", async () => {
    await act(async () => root.render(<Probe working />));
    // Written behind this window's back, with no event at all: the write still reads what is stored first.
    localStorage.setItem(`branch.composer.queue:${KEY}`, JSON.stringify([checking]));
    await act(async () => line!.add("Written here", []));
    expect(loadLine(localStorage, KEY).map((item) => item.id)).toEqual(["from-the-pop-out", expect.any(String)]);
  });

  it("shows another window's record, and holds this window's line behind it", async () => {
    await act(async () => root.render(<Probe working />));
    await act(async () => line!.add("Waits here", []));
    await act(async () => otherWindowWrites([checking, ...loadLine(localStorage, KEY)]));
    await act(async () => {});
    expect(line!.line.map((item) => item.state)).toEqual(["checking", "waiting"]);
    // The Trunk is free now, but the record from the other window isn't settled: nothing goes.
    await act(async () => root.render(<Probe working={false} />));
    expect(loadLine(localStorage, KEY).map((item) => item.state)).toEqual(["checking", "waiting"]);
  });

  it("drains one shared waiting item once when two windows become free", async () => {
    const deliverA = vi.fn();
    const deliverB = vi.fn();
    await act(async () => root.render(<><Probe working deliver={deliverA} /><Probe working deliver={deliverB} /></>));
    await act(async () => line!.add("One waiting turn", []));
    const id = loadLine(localStorage, KEY)[0]!.id;
    await act(async () => root.render(<><Probe working={false} deliver={deliverA} /><Probe working={false} deliver={deliverB} /></>));
    expect([...deliverA.mock.calls, ...deliverB.mock.calls]).toMatchObject([[{ id, text: "One waiting turn" }, false]]);
    expect(loadLine(localStorage, KEY)).toEqual([]);
  });

  it("gives Try again a fresh id", async () => {
    await act(async () => root.render(<Probe working />));
    await act(async () => line!.add("Try this", []));
    const original = loadLine(localStorage, KEY)[0]!.id;
    await act(async () => otherWindowWrites([{ ...loadLine(localStorage, KEY)[0]!, state: "failed", error: "refused" }]));
    await act(async () => line!.retry(original));
    expect(loadLine(localStorage, KEY)).toMatchObject([{ text: "Try this", state: "waiting" }]);
    expect(loadLine(localStorage, KEY)[0]!.id).not.toBe(original);
  });
});
