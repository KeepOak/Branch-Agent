// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { OfficePlace } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

describe("Grove loading", () => {
  it("says it is opening until the pixel office has drawn, never a blank forest", async () => {
    // The engine never answers here, so the office can't load: the Grove must still say what it is doing.
    const engine = { agentId: "main", request: () => new Promise(() => {}), onEvent: () => () => {} } as unknown as WindowEngine;
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    // Only the engine and the two callbacks matter here; the rest of PlaceProps is for the place frame.
    const props = { engine, openConversation: () => {}, createTrunk: () => {} } as unknown as React.ComponentProps<typeof OfficePlace>;
    await act(async () => root?.render(<OfficePlace {...props} />));
    const status = host.querySelector("[role=status]");
    expect(status?.textContent).toBe("Opening the Grove…");
    expect(host.textContent).not.toContain("Opening the office");
  });
});
