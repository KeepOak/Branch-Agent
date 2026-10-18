// @vitest-environment jsdom
// Composer surfaces: a raw engine error reads as one plain sentence at Regular, exact words at Advanced.
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readDraftFile } from "./attachments";
import { DockRow } from "./DockRow";
import type { WindowEngine } from "./engine";
import { HistorySearch } from "./HistorySearch";
import { PlugMenu } from "./PlugMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const engineOf = (request: (method: string) => Promise<unknown>) =>
  ({ request, onEvent: () => () => undefined, sessionKey: "agent:oak:main", agentId: "oak", scopes: [] }) as unknown as WindowEngine;

function dock(files: Parameters<typeof DockRow>[0]["files"] = [], line: Parameters<typeof DockRow>[0]["line"] = []) {
  return (
    <DockRow
      trunkName="Oak" working={false} offline={false} line={line}
      onReword={() => {}} onMoveUp={() => {}} onRemove={() => {}} onSteerQueued={() => {}} onRetry={() => {}}
      jobs={[]} onStopJob={() => {}} goal={null} onGoal={() => {}}
      files={files} preparing={0} onRemoveFile={() => {}} onShowText={() => {}}
      people={[]} onForget={() => {}} onSteer={async () => true}
    />
  );
}

describe("the composer never shows a raw engine error at Regular", () => {
  it("names a failed history search in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <HistorySearch anchor={createRef()} engine={engineOf(request)} sent={[]} draft="" onPreview={() => {}} onDone={() => {}} />,
    ));
    await settle();
    expect(host.textContent).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("names a failed tools load in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <PlugMenu anchor={createRef()} onClose={() => {}} engine={engineOf(request)} row={{}} trunkName="Oak" isAdmin patch={async () => null} />,
    ));
    await settle();
    expect(host.textContent).toContain(REACH);
    expect(host.textContent).not.toMatch(RAW);
    expect(host.textContent).toContain("Try again");
  });

  it("stores a failed attach as a plain detail, never the engine words", async () => {
    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:19031"));
    const got = await readDraftFile("1", file, "file", undefined);
    expect(got.problem).toBe("Couldn't attach: notes.txt");
    expect(got.detail).toBe(REACH);
    expect(got.detail).not.toMatch(/ECONNREFUSED|19031|127\.0\.0\.1/);
  });

  it("does not put raw attach detail in the file-chip tooltip", async () => {
    await act(async () => root.render(dock([{
      id: "1", kind: "file", fileName: "notes.txt", mimeType: "text/plain", sizeBytes: 1, origin: "file",
      problem: "Couldn't attach: notes.txt", detail: ENGINE,
    }])));
    const chip = host.querySelector<HTMLElement>("[data-testid='file-chip']");
    expect(chip?.getAttribute("title")).toBe("Couldn't attach: notes.txt");
    expect(chip?.getAttribute("title")).not.toMatch(RAW);
    expect(host.textContent).toContain("Couldn't attach: notes.txt");
    expect(host.textContent).not.toMatch(RAW);
  });

  it("names a failed waiting-line send in a plain sentence", async () => {
    await act(async () => root.render(dock([], [{ id: "q1", text: "hello", files: [], state: "failed", error: ENGINE }])));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid='queue-chip']")!.click());
    await settle();
    expect(host.textContent).toContain(`Not sent: ${REACH}`);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(
      <HistorySearch anchor={createRef()} engine={engineOf(request)} sent={[]} draft="" onPreview={() => {}} onDone={() => {}} />,
    ));
    await settle();
    expect(host.textContent).toContain(ENGINE);

    const file = new File(["x"], "notes.txt", { type: "text/plain" });
    vi.spyOn(file, "arrayBuffer").mockRejectedValue(new Error(ENGINE));
    const got = await readDraftFile("2", file, "file", undefined);
    expect(got.detail).toBe(ENGINE);
  });
});
