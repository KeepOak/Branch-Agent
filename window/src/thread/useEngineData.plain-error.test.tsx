// @vitest-environment jsdom
// Raw errors survive reads and level changes; only the rendering converts them.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { useApprovalDetails, useHelpers, useReactions } from "./useEngineData";
import { plainError } from "../shell/plain-error";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
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

function engineOf(request: (method: string, params?: unknown) => Promise<unknown>): WindowEngine {
  return { request, sessionKey: "agent:main:main", scopes: [], onEvent: () => () => undefined } as unknown as WindowEngine;
}

function Probe({ engine }: { engine: WindowEngine }) {
  const helpers = useHelpers(engine);
  const approvals = useApprovalDetails(engine);
  const reactions = useReactions(engine);
  return (
    <div>
      <p data-testid="helper-run">{plainError(helpers.helpers[0]?.error ?? "")}</p>
      <p data-testid="helpers-error">{plainError(helpers.error ?? "")}</p>
      <p data-testid="approvals-error">{plainError(approvals.error ?? "")}</p>
      <p data-testid="reactions-error">{plainError(reactions.error ?? "")}</p>
    </div>
  );
}

describe("engine helper data formats errors at draw time", () => {
  it("wraps lastRunError on a helper row", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      const spawnedBy = (params && typeof params === "object" ? (params as { spawnedBy?: unknown }).spawnedBy : undefined);
      if (method === "sessions.list") {
        return { sessions: spawnedBy === "agent:main:main" ? [{ key: "agent:main:subagent:reader", spawnedBy: "agent:main:main", status: "failed", label: "Reader", lastRunError: ENGINE }] : [] };
      }
      if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
      if (method === "users.self") return {};
      if (method === "session.reactions.list") return { reactions: {} };
      return {};
    });
    const engine = engineOf(request);
    await act(async () => root.render(<Probe engine={engine} />));
    await settle();
    const line = host.querySelector("[data-testid='helper-run']")?.textContent ?? "";
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
    const reads = request.mock.calls.length;
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<Probe engine={engine} />));
    expect(host.querySelector("[data-testid='helper-run']")?.textContent).toBe(ENGINE);
    expect(request.mock.calls.length).toBe(reads);
  });

  it("wraps a refused helpers, approvals and reactions read", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    const engine = engineOf(request);
    await act(async () => root.render(<Probe engine={engine} />));
    await settle();
    for (const id of ["helpers-error", "approvals-error", "reactions-error"]) {
      const line = host.querySelector(`[data-testid='${id}']`)?.textContent ?? "";
      expect(line).toBe(REACH);
      expect(line).not.toMatch(RAW);
    }
    const reads = request.mock.calls.length;
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<Probe engine={engine} />));
    for (const id of ["helpers-error", "approvals-error", "reactions-error"]) {
      expect(host.querySelector(`[data-testid='${id}']`)?.textContent).toBe(ENGINE);
    }
    expect(request.mock.calls.length).toBe(reads);
  });

  it("keeps the exact lastRunError at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async (method: string, params?: unknown) => {
      const spawnedBy = (params && typeof params === "object" ? (params as { spawnedBy?: unknown }).spawnedBy : undefined);
      if (method === "sessions.list") {
        return { sessions: spawnedBy === "agent:main:main" ? [{ key: "agent:main:subagent:reader", spawnedBy: "agent:main:main", status: "failed", label: "Reader", lastRunError: ENGINE }] : [] };
      }
      if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
      if (method === "users.self") return {};
      if (method === "session.reactions.list") return { reactions: {} };
      return {};
    });
    await act(async () => root.render(<Probe engine={engineOf(request)} />));
    await settle();
    expect(host.querySelector("[data-testid='helper-run']")?.textContent).toBe(ENGINE);
  });
});
