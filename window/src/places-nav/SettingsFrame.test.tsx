// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { SettingsFrame } from "./SettingsFrame";
import { Ctl, KitProvider, Page, Sec } from "../places/settings/kit";
import { SETTINGS_ROWS } from "../places/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const engine: WindowEngine = { request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function open(page: string, onPage = vi.fn()) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root?.render(<SettingsFrame page={page} backName="Sapling" engine={engine} onPage={onPage} onBack={() => {}} />));
  return onPage;
}

describe("settings frame level", () => {
  it("opening an Advanced page at Regular raises the level and shows that page", async () => {
    localStorage.setItem("branch.level", "regular");
    const onPage = await open("advanced");
    expect(document.querySelector('[data-level="advanced"]')?.getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector('.set-item[data-page="advanced"]')?.getAttribute("aria-current")).toBe("true");
    expect(localStorage.getItem("branch.level")).toBe("advanced");
    expect(onPage).not.toHaveBeenCalledWith("general");
  });

  it("lowering the level by hand still moves a hidden page to General", async () => {
    localStorage.setItem("branch.level", "advanced");
    const onPage = await open("advanced");
    await act(async () => (document.querySelector('[data-level="regular"]') as HTMLButtonElement).click());
    expect(onPage).toHaveBeenCalledWith("general");
  });

  it("a row found by search opens its page at the level that shows it", async () => {
    localStorage.setItem("branch.level", "regular");
    const onPage = await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "region"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    const hit = document.querySelector<HTMLButtonElement>('[data-row-hit="Region"]')!;
    expect(hit.textContent).toContain("Technical");
    await act(async () => hit.click());
    expect(onPage).toHaveBeenCalledWith("accounts");
    expect(localStorage.getItem("branch.level")).toBe("technical");
  });

  it("uses display groups without hidden depth suffixes for every search row", () => {
    expect(SETTINGS_ROWS.length).toBeGreaterThan(0);
    const bad = SETTINGS_ROWS.filter((row) => /, (?:more|technical|in depth)$/i.test(row.group ?? row.sec ?? ""));
    expect(bad.map((row) => `${row.page}: ${row.title} (${row.group ?? row.sec})`)).toEqual([]);
  });

  it("a row found by search gets focus on its own control, not on its pin", async () => {
    localStorage.setItem("branch.level", "regular");
    Element.prototype.scrollIntoView = vi.fn(); // jsdom has no layout
    await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "finish setting"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => document.querySelector<HTMLButtonElement>('[data-row-hit="Show “Finish setting up”"]')!.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const row = document.querySelector('.set-col [data-row="Show “Finish setting up”"]')!;
    expect(row.querySelector(".pin-k")).not.toBeNull();
    expect(document.activeElement).toBe(row.querySelector('input[role="switch"]'));
  });

  it("says no setting matches", async () => {
    await open("general");
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzzz"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(document.querySelector(".set-nomatch")?.textContent).toBe("No setting matches.");
  });

  it("someone who may not change setup doesn't see the setup-only pages", async () => {
    const plain = { ...engine, scopes: ["operator.read"] } as WindowEngine;
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(<SettingsFrame page="gateway" backName="Sapling" engine={plain} onPage={vi.fn()} onBack={() => {}} />));
    expect(document.querySelector('.set-item[data-page="gateway"]')).toBeNull();
    expect(document.querySelector('.set-item[data-page="general"]')?.getAttribute("aria-current")).toBe("true");
  });
});


describe("settings keyboard navigation", () => {
  it("moves focus through grouped page links without changing pages until activated", async () => {
    const onPage = await open("general");
    const pages = [...document.querySelectorAll<HTMLButtonElement>(".set-nav .set-item")];
    pages[0].focus();
    await act(async () => pages[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(pages[1]);
    expect(onPage).not.toHaveBeenCalled();
    await act(async () => pages[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(pages.at(-1));
    await act(async () => pages.at(-1)!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(pages[0]);
    await act(async () => pages[0].click());
    expect(onPage).toHaveBeenCalledWith("general");
  });

  it("level radio arrows move focus as well as choice, including Home and End", async () => {
    await open("general");
    const regular = document.querySelector<HTMLButtonElement>('[data-level="regular"]')!;
    regular.focus();
    await act(async () => regular.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-level")).toBe("advanced");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-level")).toBe("technical");
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement?.getAttribute("data-level")).toBe("regular");
  });
});

describe("settings page help", () => {
  it("keeps long explanations in help and asks from its final row", async () => {
    const ask = vi.fn();
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root?.render(
      <KitProvider level={0} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }} scope={null} ask={ask} askName="Sapling">
        <Page title="General" lede="Set up the way Branch starts.">
          <Sec title="Starting up">
            <Ctl title="Start with Windows" sub="Branch waits in the tray." help="Branch waits in the tray and keeps scheduled work running when the window is closed."><button>Change</button></Ctl>
          </Sec>
        </Page>
      </KitProvider>,
    ));
    expect(document.querySelector(".lede")?.textContent).toBe("Set up the way Branch starts.");
    expect(document.querySelector(".ctl > small")?.textContent?.length).toBeLessThanOrEqual(70);
    expect(document.querySelector(".link-k")?.textContent).not.toBe("Learn more");
    await act(async () => window.dispatchEvent(new Event("branch-settings-help")));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Branch waits in the tray and keeps scheduled work running when the window is closed.");
    expect(document.querySelector(".kit-help-ask")?.textContent).toBe("Ask Sapling about this page");
    await act(async () => document.querySelector<HTMLButtonElement>(".kit-help-ask")!.click());
    expect(ask).toHaveBeenCalledWith("Tell me about Settings › General.");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
