// @vitest-environment jsdom
// A helper's last run error is one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HelpersTree } from "./Helpers";
import type { Helper } from "./useEngineData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|19031/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:19031";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

const helper = (error: string): Helper => ({
  key: "agent:main:subagent:reader", name: "Reader", status: "failed", parent: "agent:main:main", error,
});

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

describe("a helper's last run never shows a raw engine error at Regular", () => {
  it("names a refused connect in a plain sentence", async () => {
    await act(async () => root.render(
      <HelpersTree helpers={[helper(ENGINE)]} approvals={[]} root="agent:main:main" onStop={() => undefined} onAnswer={() => undefined} />,
    ));
    const line = host.querySelector(".helper-error")?.textContent ?? "";
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
  });

  it("keeps already-plain copy unchanged", async () => {
    await act(async () => root.render(
      <HelpersTree helpers={[helper("Partial result")]} approvals={[]} root="agent:main:main" onStop={() => undefined} onAnswer={() => undefined} />,
    ));
    expect(host.querySelector(".helper-error")?.textContent).toBe("Partial result");
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(
      <HelpersTree helpers={[helper(ENGINE)]} approvals={[]} root="agent:main:main" onStop={() => undefined} onAnswer={() => undefined} />,
    ));
    expect(host.querySelector(".helper-error")?.textContent).toBe(ENGINE);
  });
});
