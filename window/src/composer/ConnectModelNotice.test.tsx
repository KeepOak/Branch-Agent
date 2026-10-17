// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONNECT_MODEL_ACTION, CONNECT_MODEL_ANSWERS } from "./connect-model";
import { ConnectModelNotice } from "./ConnectModelNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ConnectModelNotice", () => {
  it("shows Connect a model to get answers and one Connect a model button", async () => {
    const onOpen = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ConnectModelNotice onOpen={onOpen} />));
      expect(host.textContent).toContain(CONNECT_MODEL_ANSWERS);
      const buttons = [...host.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent)).toEqual([CONNECT_MODEL_ACTION]);
      await act(async () => buttons[0]!.click());
      expect(onOpen).toHaveBeenCalledExactlyOnceWith("settings/accounts/add");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("adds Try again next to Connect a model when retry is offered", async () => {
    const onRetry = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<ConnectModelNotice onRetry={onRetry} />));
      expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual([CONNECT_MODEL_ACTION, "Try again"]);
      await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
      expect(onRetry).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
