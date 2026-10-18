// @vitest-environment jsdom
// Private #1093, every greyed control says why: the Classic Settings rows the R1 frame re-hosts (Models, Models › Local,
// Permissions). A control is either live, or greyed with a visible line it names, or (when its only reason is a
// developer note, the setting not existing yet) shown only at Technical.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CANT_YET, Ctl, KitProvider, Switch, type Lv } from "./kit";
import { Runtimes } from "./set1/local-runtimes";
import { READING, SectionView, type Ctx, type Section } from "./set1/permissions-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const REPORT = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
const draw = (level: Lv, node: ReactNode) => act(async () => root.render(<KitProvider level={level} report={REPORT} scope={null}>{node}</KitProvider>));
/** The line a control names with aria-describedby, or "". */
const reasonOf = (el: Element | null | undefined) => {
  const id = el?.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? "" : "";
};
const NONE = "Branch has no setting for this yet.";

describe("Private #1093: a Classic row greyed by a developer note still says why, plainly", () => {
  it("gives Planning and hard problems a plain line in place of the developer note, at every level", async () => {
    const row = <Ctl title="Planning and hard problems" sub="When a task has many steps." off={NONE}><Switch checked={false} label="Planning and hard problems" onChange={() => undefined} /></Ctl>;
    for (const level of [0, 1, 2] as const) {
      await draw(level, row);
      const sw = host.querySelector("[role=switch]");
      expect(sw, String(level)).not.toBeNull();
      expect(reasonOf(sw), String(level)).toBe(CANT_YET);
      expect(host.querySelector(".why-k")?.textContent).toBe(CANT_YET);
      expect(host.textContent).not.toContain(NONE);
    }
  });

  it("keeps a row greyed for a real condition at every level, with its reason on a line the control names", async () => {
    const row = <Ctl title="Share with your other computers" sub="Their Trunks use this computer’s models." off="Turn on Ollama first."><Switch checked={false} label="Share" onChange={() => undefined} /></Ctl>;
    await draw(0, row);
    expect(reasonOf(host.querySelector("[role=switch]"))).toBe("Turn on Ollama first.");
  });
});

describe("Private #1093: LocalAI and Jan say why Look for it is greyed", () => {
  it("names a visible line from each greyed Look for it, and leaves the runtimes Branch can look for live", async () => {
    const res = (data: unknown) => ({ data, error: undefined, loading: false, reload: vi.fn(async () => undefined) }) as never;
    const engine = { request: vi.fn(async () => ({})), features: { methods: [] } } as unknown as WindowEngine;
    await draw(1, <Runtimes engine={engine} hw={{ mac: true, windows: false }} detect={res({ candidates: [], unavailableCandidates: [] })} models={res({ models: [] })} found={new Set()} />);
    const look = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "Look for it");
    const greyed = look.filter((b) => b.disabled);
    expect(greyed).toHaveLength(2);
    for (const b of greyed) expect(reasonOf(b)).toBe("Branch can’t look for this runtime yet. Add it in Accounts as your own service.");
    expect(look.filter((b) => !b.disabled).length).toBeGreaterThan(3);
    for (const b of greyed) expect(b.getAttribute("title")).toBeNull();
  });
});

describe("Private #1093: the standing-permission expiry field says why it is greyed", () => {
  const RULES: Section = { title: "Rules for each tool and folder", lv: 0, rows: [
    { k: "num", t: "Standing permissions end after", sub: "How long a new Always allow for an automation lasts. Empty means until revoked.", path: "tools.exec.grantExpiryDays", unit: "days", ph: "Until revoked", min: 1, max: 3650 },
  ] };
  const ctx = (loading: boolean) => ({ cfg: { loading, get: () => undefined, set: vi.fn() } }) as unknown as Ctx;

  it("is greyed only while the settings are read, with that reason beside it, then live", async () => {
    await draw(1, <SectionView s={RULES} x={ctx(true)} />);
    const field = () => host.querySelector<HTMLInputElement>("input[aria-label='Standing permissions end after']");
    expect(field()?.disabled).toBe(true);
    expect(reasonOf(field())).toBe(READING);
    await draw(1, <SectionView s={RULES} x={ctx(false)} />);
    expect(field()?.disabled).toBe(false);
    expect(host.textContent).not.toContain(READING);
  });
});
