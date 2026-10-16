// @vitest-environment jsdom
// UI audit N5: a new Trunk's empty state offers "Tell it its job", which opens its editor, instead of generic chores.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const conv = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../composer/useConversation", () => ({ useConversation: () => conv.value, hasNoModel: () => false }));
vi.mock("../composer/model", () => ({ currentModelRef: () => "anthropic/model" }));
vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("./context", () => ({ useThread: () => ({ name: "New Trunk", engine: undefined }) }));

import { EmptyState } from "./EmptyState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
async function mount() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<EmptyState onStart={() => {}} />); });
}
const trunk = (id: string, theme: string) => ({ id, name: "New Trunk", defaultMode: "", theme, model: "" });
const buttons = () => [...document.querySelectorAll(".starters button")].map((b) => b.textContent);

describe("EmptyState for a Trunk with no job", () => {
  it("offers Tell it its job and opens the Trunk's editor instead of the everyday chores", async () => {
    conv.value = { loaded: true, row: {}, defaults: {}, trunk: trunk("new-trunk", ""), defaultTrunkId: "main" };
    const events: [string, unknown][] = [];
    const listen = (e: Event) => events.push([e.type, (e as CustomEvent).detail]);
    window.addEventListener("branch:navigate-place", listen);
    window.addEventListener("branch:open-trunk", listen);
    try {
      await mount();
      expect(buttons()).toEqual(["Tell it its job"]);
      expect(document.querySelector(".empty-where")?.textContent).toContain("New Trunk has no job yet");
      await act(async () => { (document.querySelector(".starters button") as HTMLButtonElement).click(); });
      expect(events).toEqual([
        ["branch:navigate-place", { place: "people" }],
        ["branch:open-trunk", { agentId: "new-trunk", view: "edit" }],
      ]);
    } finally {
      window.removeEventListener("branch:navigate-place", listen);
      window.removeEventListener("branch:open-trunk", listen);
    }
  });

  it("keeps the everyday starters for the default Trunk", async () => {
    conv.value = { loaded: true, row: {}, defaults: {}, trunk: trunk("main", ""), defaultTrunkId: "main" };
    await mount();
    expect(buttons()[0]).toBe("Tidy my Downloads folder");
    expect(buttons()).not.toContain("Tell it its job");
  });
});
