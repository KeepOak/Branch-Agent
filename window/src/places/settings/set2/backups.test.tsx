// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { BackupsPage } from "./backups";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    if (a === undefined) return {};
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<BackupsPage page="backups" title="Backups" level="regular" engine={engine} />));
  await flush();
}
function button(text: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
async function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
  await flush();
}
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const EMPTY = { targets: [], schedules: [], locations: [] };
const REPO = "C:\\Users\\me\\.branch-backup-1a2b3c4d5e6f";
const SCHEDULED = {
  targets: [{ kind: "git", target: REPO, latest: { id: "r", createdAt: Date.now() - 60_000, archivePath: REPO, status: "ok", kind: "git", target: "0123456789abcdef" } }],
  schedules: [{ id: "job-1", mode: "git", target: REPO, enabled: true, everyMs: 86_400_000, push: true, excludeSecrets: true, files: true, remote: "https://github.com/KeepOak/Branch-Agent-Private.git" }],
  locations: [],
};

describe("Settings › Backups", () => {
  it("saves a private Git repository as the destination, every day by default", async () => {
    const { engine, request } = engineWith({ "backup.status": EMPTY, "backup.schedule.set": { id: "job-1" } });
    await show(engine);
    expect(button("Back up now").disabled).toBe(true);
    expect(document.body.textContent).toContain("Passwords, keys and sign-ins are never included");
    expect(document.body.textContent).toContain("KeepOak/Branch-Agent-Private");
    await type("Repository address", "https://github.com/KeepOak/Branch-Agent-Private.git");
    await click("Save");
    expect(calls(request, "backup.schedule.set")).toEqual([
      { destination: { kind: "git", url: "https://github.com/KeepOak/Branch-Agent-Private.git" }, everyMs: 86_400_000, enabled: true },
    ]);
  });

  it("shows the schedule and last result, changes how often, and backs up now", async () => {
    const { engine, request } = engineWith({ "backup.status": SCHEDULED, "backup.schedule.set": { id: "job-1" }, "backup.run": { jobId: "job-1", started: true } });
    await show(engine);
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Repository address"]')!.value).toBe("https://github.com/KeepOak/Branch-Agent-Private.git");
    expect(document.querySelector('[data-row="Last backup"]')!.textContent).toContain("Saved as 0123456789");
    expect(document.querySelector('[data-row="Last backup"]')!.textContent).toContain("Succeeded");
    await click("Every week");
    expect(calls(request, "backup.schedule.set").at(-1)).toEqual({ destination: { kind: "git", url: "https://github.com/KeepOak/Branch-Agent-Private.git" }, everyMs: 604_800_000, enabled: true });
    await click("Off");
    expect(calls(request, "backup.schedule.set").at(-1)).toMatchObject({ enabled: false, everyMs: 86_400_000 });
    await click("Back up now");
    expect(calls(request, "backup.run")).toEqual([{}]);
    expect(document.body.textContent).toContain("Backing up…");
  });

  it("a folder destination, the engine's refusal and forgetting the destination", async () => {
    const { engine, request } = engineWith({ "backup.status": SCHEDULED, "backup.schedule.set": new Error("Git backup repository must be outside the Branch Agent state directory"), "backup.schedule.clear": { removed: true } });
    await show(engine);
    await click("A folder on this computer");
    await type("Folder", "D:\\Backups\\Branch");
    await click("Save");
    expect(calls(request, "backup.schedule.set").at(-1)).toEqual({ destination: { kind: "folder", path: "D:\\Backups\\Branch" }, everyMs: 86_400_000, enabled: true });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("outside the Branch Agent state directory");
    await click("Stop backing up here");
    expect(calls(request, "backup.schedule.clear")).toEqual([{}]);
  });
});
