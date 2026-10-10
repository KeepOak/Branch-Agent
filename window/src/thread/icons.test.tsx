// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { StepKind } from "./format";
import { STEP_KIND_MARKUP, StepKindIcon } from "./icons";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const KINDS: StepKind[] = ["read", "edit", "run", "search", "fetch"];

describe("preview step icons", () => {
  it("draws one STEP_IC_PB18 icon per step kind, and a check for unknown tools", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root!.render(
        <div>
          {KINDS.map((kind) => <StepKindIcon key={kind} kind={kind} />)}
          <StepKindIcon />
        </div>,
      ),
    );
    for (const kind of KINDS) {
      const svg = host.querySelector(`[data-testid="step-icon"][data-kind="${kind}"]`);
      expect(svg).not.toBeNull();
      expect(svg?.querySelectorAll("path, rect, circle").length).toBeGreaterThan(0);
      expect(STEP_KIND_MARKUP[kind]).toBeTruthy();
    }
    expect(host.querySelector('[data-testid="step-icon"][data-kind="check"]')?.querySelector("path")).not.toBeNull();
  });
});
