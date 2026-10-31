// @vitest-environment jsdom
// Private #1093 B-047: the password-manager picker lists only managers the engine can read on this OS.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { SettingsPage } from "../index";
import { passwordManagersFor } from "./secrets";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a === undefined) return {};
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(platform: string, answers: Answers = {}) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  const env = engineWith({ "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: {} }, "secrets.store.list": { entries: [] }, ...answers });
  await act(async () => root.render(<SettingsPage page="secrets" title="Sign-ins & keys" level="advanced" engine={env.engine} />));
  await flush();
  return env;
}
const where = () => document.querySelector<HTMLElement>('[data-sec="Where passwords come from"]')!;
const managerRow = () => document.querySelector<HTMLElement>('[data-row="Use 1Password"]');
const labels = (root: Element) => [...root.querySelectorAll("button, [role=switch], option")].map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim());

/** Greyed controls that do not name a one-line reason the person can see. */
function greyedWithoutReason(root: Element): string[] {
  const found: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[disabled], [aria-disabled='true']")) {
    const title = el.getAttribute("title") ?? "";
    const described = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const why = el.closest("[data-row]")?.querySelector(".why-k")?.textContent ?? "";
    if (![title, described, why].some((t) => t.trim())) found.push((el.getAttribute("aria-label") || el.textContent || el.tagName).trim());
  }
  return found;
}

describe("passwordManagersFor", () => {
  it("lists only engine-backed managers, and never Windows, on Linux, Mac and Windows", () => {
    for (const os of ["linux", "mac", "windows", "other"] as const) {
      const ids = passwordManagersFor(os).map((m) => m.id);
      expect(ids, os).toEqual(["onepassword"]);
      expect(ids, os).not.toContain("windows");
      expect(ids, os).not.toContain("bitwarden");
    }
  });
});

describe("Settings › Saved sign-ins › password manager", () => {
  it("on Linux and on Mac, offers no Windows option and only the engine's 1Password", async () => {
    for (const platform of ["Linux x86_64", "MacIntel"]) {
      await show(platform);
      const offered = labels(where());
      expect(offered.some((l) => /1Password/.test(l)), platform).toBe(true);
      expect(offered.filter((l) => l === "Windows" || /\bWindows\b/.test(l)), platform).toEqual([]);
      expect(offered.filter((l) => /Bitwarden/.test(l)), platform).toEqual([]);
      expect(managerRow()?.querySelector('[role="switch"]')).toBeTruthy();
      expect(greyedWithoutReason(where()), platform).toEqual([]);
      expect(visibleDevNotes(where()), platform).toEqual([]);
    }
  });

  it("does not offer Windows on Windows either: the engine has no Credential Manager provider", async () => {
    await show("Win32");
    expect(labels(where()).filter((l) => l === "Windows" || /\bWindows\b/.test(l))).toEqual([]);
    expect(passwordManagersFor("windows").map((m) => m.id)).toEqual(["onepassword"]);
    expect(greyedWithoutReason(where())).toEqual([]);
  });

  it("turning on 1Password saves through the engine and shows an inline Saved tick without dropping the tick from the row", async () => {
    let config: Record<string, unknown> = {};
    const env = await show("Linux x86_64", {
      "config.get": () => ({ hash: "h", valid: true, config }),
      "config.patch": (params: Record<string, unknown>) => {
        config = { ...config, ...(JSON.parse(String(params.raw)) as Record<string, unknown>) };
        return { ok: true, hash: "h2", config };
      },
    });
    const tick = () => managerRow()!.querySelector(".checked-at span") as HTMLElement;
    expect(tick().textContent).toBe("✓ Saved");
    expect(tick().style.visibility).toBe("hidden");
    const sw = managerRow()!.querySelector<HTMLInputElement>('[role="switch"]')!;
    expect(sw.checked).toBe(false);
    await act(async () => sw.click());
    await flush();
    expect(env.request.mock.calls.some(([m]) => m === "config.patch")).toBe(true);
    expect(JSON.stringify(env.request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse(String((p as { raw: string }).raw))))).toContain("onepassword");
    expect(tick().style.visibility).toBe("visible");
    expect(managerRow()!.querySelector(".checked-at")).toBeTruthy();
  });
});
