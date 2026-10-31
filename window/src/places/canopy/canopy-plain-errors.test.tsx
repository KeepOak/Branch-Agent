// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { SessionsBoard } from "./SessionsBoard";
import type { Ctx } from "./ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows a rejected board read in plain words at Regular", async () => {
  const previousLevel = localStorage.getItem("branch.level");
  localStorage.setItem("branch.level", "regular");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const request = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
  const ctx = { engine: { request: request as WindowEngine["request"] }, d: {} } as Ctx;
  try {
    await act(async () => root.render(<SessionsBoard ctx={ctx} board={{ id: "board" }} />));
    expect(request).toHaveBeenCalledWith("canopy.sessionsBoard.read", { boardId: "board" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.",
    );
    expect(host.textContent).not.toContain("ECONNREFUSED");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (previousLevel === null) localStorage.removeItem("branch.level");
    else localStorage.setItem("branch.level", previousLevel);
  }
});
