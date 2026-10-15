// @vitest-environment jsdom
// A settings read that never answers says so after STALL_MS with a plain line, and a late answer still shows.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "./hooks";
import { STALL_MS, STALL_TEXT, stallAfter } from "./stall";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); });

function Probe({ engine }: { engine: WindowEngine }) {
  const read = useResource<{ ok: boolean }>(engine, "system.info", {});
  return <p data-state={read.loading ? "loading" : read.error ? "error" : read.data ? "data" : "none"}>{read.error ?? (read.data ? "answered" : "")}</p>;
}

describe("settings reads that never answer", () => {
  it("say so after the stall window, then show a late answer", async () => {
    let answer: (value: { ok: boolean }) => void = () => undefined;
    const engine = { request: () => new Promise<{ ok: boolean }>((resolve) => { answer = resolve; }) } as unknown as WindowEngine;
    await act(async () => { root.render(<Probe engine={engine} />); });
    expect(host.querySelector("p")?.dataset.state).toBe("loading");

    await act(async () => { vi.advanceTimersByTime(STALL_MS - 1); });
    expect(host.querySelector("p")?.dataset.state).toBe("loading");

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(host.querySelector("p")?.dataset.state).toBe("error");
    expect(host.querySelector("p")?.textContent).toBe(STALL_TEXT);

    await act(async () => { answer({ ok: true }); });
    expect(host.querySelector("p")?.dataset.state).toBe("data");
  });

  it("stopping the timer before the window ends keeps the read loading", async () => {
    const onStall = vi.fn();
    const stop = stallAfter(onStall, 100);
    stop();
    vi.advanceTimersByTime(500);
    expect(onStall).not.toHaveBeenCalled();
  });

  it("uses a window well above a normal engine answer", () => {
    expect(STALL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
