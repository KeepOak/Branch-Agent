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
async function button(container: HTMLElement, label: string) {
  await act(async () => [...container.querySelectorAll("button")].find((item) => item.textContent === label)!.click());
}
async function edit(container: HTMLElement, value: string) {
  await act(async () => {
    const textarea = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const file = { path: "/work/readme.md", name: "readme.md", content: "original", hash: "first-hash" };
async function openFile(request: ReturnType<typeof vi.fn>) {
  const container = await mount(request);
  await act(async () => container.querySelector<HTMLButtonElement>(".file-card-pn")!.click());
  await button(container, "Edit");
  return container;
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

it("preserves edits typed during a save and uses the returned hash for the next save", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn().mockResolvedValue({}).mockResolvedValueOnce({ files: [file] }).mockResolvedValueOnce({ file }).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ file: { ...file, content: "newer", hash: "third-hash" } });
  const container = await openFile(request);
  await edit(container, "saved version"); await button(container, "Keep");
  await edit(container, "newer");
  await act(async () => finish({ file: { ...file, content: "saved version", hash: "second-hash" } }));
  expect(container.querySelector("textarea")?.value).toBe("newer");
  expect(container.textContent).not.toContain("Saved.");
  await button(container, "Keep");
  expect(request).toHaveBeenLastCalledWith("sessions.files.set", { sessionKey: "agent:scout:main", path: file.path, content: "newer", expectedHash: "second-hash" });
  expect(container.querySelector("pre")?.textContent).toBe("newer");
});

it("keeps the edit and reports a backend hash conflict instead of claiming it saved", async () => {
  const request = vi.fn().mockResolvedValueOnce({ files: [file] }).mockResolvedValueOnce({ file }).mockRejectedValueOnce(new Error("File changed elsewhere"));
  const container = await openFile(request);
  await edit(container, "my edit"); await button(container, "Keep");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("File changed elsewhere");
  expect(container.querySelector("textarea")?.value).toBe("my edit");
  expect(container.textContent).not.toContain("Saved.");
});

it.each(["resolve", "reject"])("ignores a previous engine save that later %ss", async (outcome) => {
  let finish!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  const request = vi.fn().mockResolvedValueOnce({ files: [file] }).mockResolvedValueOnce({ file }).mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
  const container = await openFile(request);
  await edit(container, "previous engine draft"); await button(container, "Keep");
  const replacement = { ...file, content: "replacement engine content", hash: "replacement-hash" };
  const engine = { sessionKey: "agent:scout:main", request: vi.fn(async (method: string) => method === "sessions.files.get" ? { file: replacement } : { files: [replacement] }) } as unknown as WindowEngine;
  await act(async () => root!.render(<FilesTab engine={engine} />));
  expect(container.querySelector("pre")?.textContent).toBe("replacement engine content");
  await act(async () => outcome === "resolve" ? finish({ file: { ...file, content: "previous engine draft", hash: "old-save-hash" } }) : fail(new Error("Old connection failed")));
  expect(container.querySelector("pre")?.textContent).toBe("replacement engine content");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).not.toContain("Saved.");
});
