// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const conv = vi.hoisted(() => ({
  value: { loaded: true, row: {}, defaults: {}, models: [], modelsLoaded: true, modelsError: null, error: null },
}));
vi.mock("../composer/useConversation", () => ({
  useConversation: () => conv.value,
  hasNoModel: () => true,
}));
vi.mock("../composer/model", () => ({ currentModelRef: () => "openai/gpt-6-astra" }));
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./context", () => ({ useThread: () => ({ name: "Juniper", engine: undefined }) }));

import { EmptyState } from "./EmptyState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; document.documentElement.removeAttribute("data-theme"); });

describe("empty chat with no usable model", () => {
  it.each(["dark", "light"])("uses the readable primary button token pair in the %s theme", async (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => { root!.render(<EmptyState />); });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="connect-model"] button')!;
    expect(button.textContent).toBe("Connect a model");
    expect(button.classList.contains("pri")).toBe(true);
    // Keep the foreground and background paired, even outside the Classic composer styles.
    expect(button.style.background).toBe("var(--btn)");
    expect(button.style.borderColor).toBe("var(--btn)");
    expect(button.style.color).toBe("var(--on-btn)");
    // Glass controls must not replace just one side of the primary token pair.
    expect(button.hasAttribute("data-solid")).toBe(true);
  });

  it("shows Connect a model to get answers with one button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(<EmptyState onStart={() => {}} />); });
    const notice = host.querySelector('[data-testid="connect-model"]')!;
    expect(notice.textContent).toContain("Connect a model to get answers");
    expect([...notice.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Connect a model"]);
    expect(host.textContent).not.toMatch(/gpt-6-astra/i);
    expect(host.querySelector(".starters")).toBeNull();
  });
});
