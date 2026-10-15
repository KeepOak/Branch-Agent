// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAtlas, type AtlasRow } from "./atlas";
import { FeaturesPage } from "./FeaturesPage";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
// jsdom lays nothing out: give the list the 640 px it has at 1440 × 900.
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("feat-list") ? 640 : 0; } });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const row = (id: string, a: string, s: AtlasRow["s"], f: string): AtlasRow => ({ id, a, f, w: `${f} in detail`, s, p: "pack1" });
const rows: AtlasRow[] = [
  row("TOOLS-1", "tools", "in Branch", "Run shell commands"),
  row("TOOLS-2", "tools", "planned", "Spreadsheet tool"),
  row("VOICE-1", "voice", "partly built", "Talk mode"),
  row("RES-1", "research", "in Branch", "Deep research"),
  row("OPS-1", "ops", "in Branch", "Gateway restart"),
];

const render = async (props: Partial<Parameters<typeof FeaturesPage>[0]> = {}) => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<FeaturesPage technical={false} rows={rows} {...props} />));
  const text = () => host.textContent ?? "";
  const type = async (value: string) => {
    const input = host.querySelector<HTMLInputElement>("input[aria-label='Search all features']")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const pick = async (name: string) => {
    const button = [...host.querySelectorAll<HTMLButtonElement>("[role='radio']")].find((b) => b.textContent?.startsWith(name));
    expect(button, name).toBeTruthy();
    await act(async () => button!.click());
  };
  return { host, text, type, pick };
};

describe("All features", () => {
  it("shows kinds, areas and rows with their status chips and the count line", async () => {
    const t = await render();
    expect(t.text()).toContain("Tools and connections");
    expect(t.text()).toContain("Run shell commands");
    const chips = [...t.host.querySelectorAll(".feat-chip")].map((c) => c.textContent);
    expect(chips).toEqual(expect.arrayContaining(["In Branch", "Coming", "Partly built"]));
    expect(t.host.querySelector(".feat-count")!.textContent).toMatch(/^In Branch \d+ · Coming \d+ · 1 more at the Technical level$/);
    expect(t.host.querySelector("input")!.placeholder).toBe("Search 5 features");
    expect([...t.host.querySelectorAll("[role='radio']")].map((b) => b.textContent)).toEqual(["All 5", "In Branch 3", "Partly built 1", "Coming 1"]);
  });

  it("filters by status and searches, and says so when nothing matches", async () => {
    const t = await render();
    await t.pick("Coming");
    expect(t.host.querySelector(".feat-count")!.textContent).toBe("1 of 5 features");
    expect(t.text()).toContain("Spreadsheet tool");
    expect(t.text()).not.toContain("Run shell commands");
    await t.pick("All");
    await t.type("gateway");
    expect(t.text()).toContain("Gateway restart");
    expect(t.host.querySelector(".feat-count")!.textContent).toBe("1 of 5 features");
    await t.type("zzz");
    expect(t.text()).toContain("Nothing matches. Try another word.");
  });

  it("shows the Technical areas at Technical", async () => {
    const t = await render({ technical: true });
    expect(t.text()).toContain("Running Branch");
    expect(t.host.querySelector(".feat-count")!.textContent).toMatch(/^In Branch \d+ · Coming \d+$/);
  });

  it("draws Open only where the host can go and the feature exists at least in part", async () => {
    const quiet = await render();
    expect(quiet.host.querySelector(".feat-go")).toBeNull();
    await act(async () => root!.unmount()); root = undefined;
    const onOpen = vi.fn();
    const t = await render({ onOpen });
    const opens = [...t.host.querySelectorAll<HTMLButtonElement>(".feat-go")].map((b) => b.getAttribute("aria-label"));
    expect(opens).toContain("Open where Run shell commands lives");
    expect(opens).toContain("Open where Talk mode lives");
    expect(opens).not.toContain("Open where Spreadsheet tool lives");
    expect(opens).not.toContain("Open where Deep research lives");
    await act(async () => t.host.querySelector<HTMLButtonElement>("[aria-label='Open where Talk mode lives']")!.click());
    expect(onOpen).toHaveBeenCalledWith({ kind: "settings", page: "voice" });
    await act(async () => t.host.querySelector<HTMLButtonElement>("[aria-label='Open Tools']")!.click());
    expect(onOpen).toHaveBeenLastCalledWith({ kind: "place", place: "customize", tab: "tools" });
  });

  it("deep-links to a feature, searching for it when its area shows only at Technical", async () => {
    const t = await render({ focus: "OPS-1" });
    expect(t.host.querySelector<HTMLInputElement>("input")!.value).toBe("Gateway restart");
    expect(t.host.querySelector(".feat-r.focus")!.getAttribute("data-fid")).toBe("OPS-1");
  });

  it("marks every control as local: the page needs no engine call", async () => {
    const t = await render({ onOpen: () => {} });
    const controls = [...t.host.querySelectorAll("button, input")];
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) expect(control.closest("[data-local]"), control.outerHTML).not.toBeNull();
  });

  it("draws only the rows near the viewport of a long list", async () => {
    const long = Array.from({ length: 2000 }, (_, i) => row(`T-${i}`, "tools", "planned", `Feature ${i}`));
    const t = await render({ rows: long });
    expect(t.host.querySelectorAll(".feat-r").length).toBeLessThan(20);
    expect(t.host.querySelector<HTMLElement>(".feat-in")!.style.height).toBe(`${44 + 34 + 2000 * 58}px`);
  });

  it("loads the shipped atlas when no rows are given", async () => {
    const t = await render({ rows: undefined });
    await act(async () => { await loadAtlas(); });
    expect(t.host.querySelector(".feat-count")!.textContent).toMatch(/^In Branch [\d,]+ · Coming [\d,]+ · [\d,]+ more at the Technical level$/);
  });
});

describe("the page's glass (README item 48; the full check is glass48.test.tsx)", () => {
  const css = readFileSync(join(process.cwd(), "src/screens/features/features.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf("}", at));
  };
  const background = (selector: string): string => /background:\s*([^;]+);/.exec(rule(selector))?.[1]?.trim() ?? "";

  it("lifts row hover and the focused row with the shared pill's light lift, and the chips (shared pills) keep their status colours, never a solid fill", () => {
    expect(background(".feat-r:hover")).toBe("var(--gp-on)");
    expect(background(".feat-r.focus")).toBe("var(--gp-on)");
    expect(rule(".feat-r.focus")).toContain("inset 0 0 0 1px var(--gp-edge)");
    expect(background(".feat-chip")).toBe("");
    expect(css).not.toMatch(/var\(--(ok|warn)-tint\)/);
    expect(rule(".feat-chip.in:not(#g48#g48)")).toContain("var(--ok)");
    expect(rule(".feat-chip.part:not(#g48#g48)")).toContain("var(--warn)");
  });

  it("leaves the search box and Open to the shared pill (frost and 1px outline), with no drawn line", () => {
    for (const sel of [".feat-search", ".feat-go"]) {
      expect(background(sel), sel).toBe("");
      expect(rule(sel), sel).not.toMatch(/border: [^;]*solid/);
    }
    expect(css).not.toMatch(/background:\s*var\(--fill\)/);
    expect(css).not.toMatch(/var\(--line\)/);
  });
});
