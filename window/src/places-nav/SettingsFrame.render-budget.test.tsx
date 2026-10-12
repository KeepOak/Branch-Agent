// @vitest-environment jsdom
// Render budget for a Settings save (board #747, cloud QA #532): a switch or a pin used to redraw the whole frame
// and every row four or five times ("Saving…", the patch, the re-read, "Saved", the line clearing 2 s later).
// The page draws once for the change; rows that only read the kit do not redraw at all.
import { act, memo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { forgetLookStore } from "../places/settings/set1/appearance-store";
import { SettingsFrame } from "./SettingsFrame";

const drawn = vi.hoisted(() => ({ page: vi.fn(), row: vi.fn() }));

vi.mock("../places/settings", async () => {
  const kit = await import("../places/settings/kit");
  const CountedRow = memo(function CountedRow({ n }: { n: number }) {
    kit.useLevel();
    kit.useSaved();
    drawn.row();
    return <span data-counted={n} />;
  });
  function TestPage({ engine }: { engine: WindowEngine }) {
    drawn.page();
    const config = kit.useConfig(engine);
    const on = config.get("x.on") === true;
    return (
      <kit.Page title="General" lede="">
        <kit.Sec title="Test">
          <kit.Ctl title="Test switch"><kit.Switch label="Test switch" checked={on} onChange={(next) => void config.set("x.on", next)} /></kit.Ctl>
          {Array.from({ length: 20 }, (_, n) => <CountedRow key={n} n={n} />)}
        </kit.Sec>
      </kit.Page>
    );
  }
  return { SETTINGS_ROWS: [], SettingsPage: (props: { engine: WindowEngine }) => <TestPage engine={props.engine} /> };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;

function fakeEngine(): WindowEngine {
  let hash = "h0";
  let config: Record<string, unknown> = { x: { on: false } };
  let look: unknown;
  const request = vi.fn(async (method: string, params?: unknown) => {
    const p = (params ?? {}) as Record<string, unknown>;
    if (method === "config.get") return { hash, valid: true, config };
    if (method === "config.patch") {
      hash = hash + "x";
      config = { x: { ...(config.x as object), ...(JSON.parse(String(p.raw)) as { x: object }).x } };
      return { ok: true, hash, config };
    }
    if (method === "users.prefs.get") return { status: "ok", entries: look === undefined ? {} : { "ui.window.look": look } };
    if (method === "users.prefs.set") { look = (p.entries as Record<string, unknown>)["ui.window.look"]; return { status: "ok" }; }
    if (method === "themes.list") return { current: { id: "branch" } };
    return {};
  });
  return { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] };
}

async function open(engine: WindowEngine) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<SettingsFrame page="general" backName="Sapling" engine={engine} onPage={() => {}} onBack={() => {}} />));
  await settle();
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(10); });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem("branch.level", "regular");
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  forgetLookStore();
  vi.useRealTimers();
});

describe("settings save render budget", () => {
  it("a switch redraws the page once and no kit-only row, through Saving, Saved and the line clearing", async () => {
    await open(fakeEngine());
    const box = document.querySelector<HTMLInputElement>('input[aria-label="Test switch"]')!;
    expect(box.checked).toBe(false);
    drawn.page.mockClear();
    drawn.row.mockClear();
    await act(async () => box.click());
    await settle();
    expect(box.checked).toBe(true);
    expect(document.querySelector(".set-save")?.textContent).toContain("Saved");
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(document.querySelector<HTMLElement>(".set-save")?.hidden).toBe(true);
    expect(drawn.page.mock.calls.length).toBeLessThanOrEqual(1);
    expect(drawn.row).not.toHaveBeenCalled();
  });

  it("a pin redraws the pins, not the page or its rows", async () => {
    await open(fakeEngine());
    drawn.page.mockClear();
    drawn.row.mockClear();
    const pin = document.querySelector<HTMLButtonElement>('button[aria-label="Pin Test switch"]')!;
    await act(async () => pin.click());
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(document.querySelector('button[aria-label="Unpin Test switch"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(drawn.page).not.toHaveBeenCalled();
    expect(drawn.row).not.toHaveBeenCalled();
  });
});
