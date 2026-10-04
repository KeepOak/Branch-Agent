// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Inspect } from "./Inspect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function render() {
  const pending: ReturnType<typeof deferred>[] = [];
  const request = vi.fn(() => {
    const task = deferred();
    pending.push(task);
    return task.promise;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.read"] };
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Inspect engine={engine} title="My task" at={new Date()} runId="run-1" close={() => {}} />));
  const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Start again")!;
  return { pending, request, retry };
}

const result = (missing: string) => ({ identity: { state: "unknown", missingEvidence: [missing] }, coverage: { state: "unattributed" }, decisionDisplays: [] });

describe("Inbox run inspection retry", () => {
  it("keeps the newest record when the first request finishes after Start again", async () => {
    const { pending, request, retry } = await render();
    await act(async () => retry.click());
    expect(request.mock.calls).toEqual([["audit.run.inspect", { runId: "run-1" }], ["audit.run.inspect", { runId: "run-1" }]]);
    await act(async () => pending[1].resolve(result("new evidence")));
    expect(document.body.textContent).toContain("Nothing was recorded for new evidence.");
    await act(async () => pending[0].resolve(result("old evidence")));
    expect(document.body.textContent).toContain("Nothing was recorded for new evidence.");
    expect(document.body.textContent).not.toContain("old evidence");
  });

  it("ignores stale failures and lets a current failure retry successfully", async () => {
    const { pending, retry } = await render();
    await act(async () => retry.click());
    await act(async () => pending[0].reject(new Error("old failure")));
    expect(document.body.textContent).not.toContain("old failure");
    expect(document.body.textContent).toContain("Reading the record…");
    await act(async () => pending[1].reject(new Error("current failure")));
    expect(document.querySelector("[role=alert]")?.textContent).toBe("current failure");
    await act(async () => retry.click());
    await act(async () => pending[2].resolve(result("current evidence")));
    expect(document.body.textContent).toContain("current evidence");
    expect(document.querySelector("[role=alert]")).toBeNull();
  });
});
