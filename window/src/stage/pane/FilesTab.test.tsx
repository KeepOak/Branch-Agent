// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { FilesTab } from "./FilesTab";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
const entry = (name: string, kind = "file") => ({ path: `/work/${name}`, name, kind });
const rootListing = { root: "/work", files: [], browser: { entries: [entry("src", "directory")] } };
async function mount(request: ReturnType<typeof vi.fn>) {
  const engine = { sessionKey: "agent:scout:main", request } as unknown as WindowEngine;
  const container = document.createElement("div");
  document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<FilesTab engine={engine} />));
  return container;
}
async function toggle(container: HTMLElement) {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="treeitem"][aria-expanded]')!.click());
}

it("recovers a failed directory read when the folder is reopened", async () => {
  const request = vi.fn().mockResolvedValueOnce(rootListing).mockRejectedValueOnce(new Error("Computer offline")).mockResolvedValueOnce({ browser: { entries: [entry("ready.ts")] } });
  const container = await mount(request);
  await toggle(container);
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Computer offline");
  await toggle(container); await toggle(container);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("ready.ts");
  expect(request).toHaveBeenLastCalledWith("sessions.files.list", { sessionKey: "agent:scout:main", path: "/work/src" });
});

it("ignores an old folder response after closing and reopening it", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockResolvedValueOnce(rootListing).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ browser: { entries: [entry("fresh.ts")] } });
  const container = await mount(request);
  await toggle(container); await toggle(container); await toggle(container);
  await act(async () => finish({ browser: { entries: [entry("old.ts")] } }));
  expect(container.textContent).toContain("fresh.ts");
  expect(container.textContent).not.toContain("old.ts");
});

it("explains an expanded empty folder and refreshes it on reopen", async () => {
  const request = vi.fn().mockResolvedValueOnce(rootListing).mockResolvedValueOnce({ browser: { entries: [] } }).mockResolvedValueOnce({ browser: { entries: [entry("created.ts")] } });
  const container = await mount(request);
  await toggle(container);
  expect(container.textContent).toContain("This folder is empty.");
  await toggle(container); await toggle(container);
  expect(container.textContent).toContain("created.ts");
  expect(container.textContent).not.toContain("This folder is empty.");
});
