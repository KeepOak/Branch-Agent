import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { useQuestions } from "./questions";

const question = (id: string, sessionKey: string) => ({
  id, sessionKey, createdAtMs: 100, expiresAtMs: 9e12, status: "pending",
  questions: [{ questionId: "format", header: "Format", question: "Which format?", options: [{ label: "Brief" }] }],
});
function connection(sessionKey: string) {
  const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
  let resolve: (response: unknown) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const pending = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  const engine: WindowEngine = {
    sessionKey, scopes: [], request: <T,>() => pending as Promise<T>,
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return { engine, resolve, reject, listeners, emit: (event: string, payload: unknown) => listeners.forEach((listener) => listener({ event, payload })) };
}
function Probe({ engine }: { engine: WindowEngine }) {
  const { list, error } = useQuestions(engine);
  return <output>{error ?? list.map((r) => `${r.id}:${r.status}:${r.answers?.format?.join(",") ?? ""}`).join("|")}</output>;
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("question list and event reconciliation", () => {
  it("keeps a requested question arriving before the initial list", async () => {
    const c = connection("agent:main:one");
    await act(async () => root.render(<Probe engine={c.engine} />));
    await act(async () => c.emit("question.requested", question("new", c.engine.sessionKey!)));
    await act(async () => c.resolve({ questions: [question("existing", c.engine.sessionKey!)] }));
    expect(host.textContent).toBe("existing:pending:|new:pending:");
  });

  it("does not resurrect a question resolved before the list returns", async () => {
    const c = connection("agent:main:one");
    await act(async () => root.render(<Probe engine={c.engine} />));
    await act(async () => c.emit("question.resolved", { id: "existing", status: "answered", answers: { answers: { format: ["Brief"] } } }));
    await act(async () => c.resolve({ questions: [question("existing", c.engine.sessionKey!)] }));
    expect(host.textContent).toBe("existing:answered:Brief");
  });

  it("ignores an old conversation's delayed snapshot after switching", async () => {
    const old = connection("agent:main:one"), next = connection("agent:main:two");
    await act(async () => root.render(<Probe engine={old.engine} />));
    await act(async () => root.render(<Probe engine={next.engine} />));
    await act(async () => next.resolve({ questions: [question("current", next.engine.sessionKey!)] }));
    await act(async () => old.resolve({ questions: [question("stale", old.engine.sessionKey!)] }));
    expect(host.textContent).toBe("current:pending:");
    expect(old.listeners.size).toBe(0);
  });

  it("ignores an old connection's rejection after switching", async () => {
    const old = connection("agent:main:one"), next = connection("agent:main:two");
    await act(async () => root.render(<Probe engine={old.engine} />));
    await act(async () => root.render(<Probe engine={next.engine} />));
    await act(async () => old.reject(new Error("Old connection lost")));
    await act(async () => next.resolve({ questions: [question("current", next.engine.sessionKey!)] }));
    expect(host.textContent).toBe("current:pending:");
  });
});
