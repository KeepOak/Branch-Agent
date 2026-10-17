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
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

describe("empty chat with no usable model", () => {
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
