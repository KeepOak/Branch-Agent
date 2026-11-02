/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplicationContext } from "../../app/context.ts";
import { i18n } from "../../i18n/index.ts";
import {
  createApplicationContextProvider,
  createApplicationGateway,
} from "../../test-helpers/application-context.ts";
import { APPS_LEVEL_KEY } from "./apps-level.ts";
import "./apps-page.ts";

const NOT_OUT_YET = "Not out yet. Use the Android, Mac, Windows or Linux app for now.";

type AppsPageElement = HTMLElement & { updateComplete: Promise<boolean> };

function createAgentSelection() {
  const listeners = new Set<() => void>();
  return {
    state: { selectedId: null as string | null },
    set: () => undefined,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function mountPage() {
  const { gateway } = createApplicationGateway();
  const host = createApplicationContextProvider({
    gateway,
    navigate: vi.fn(),
    overlays: { openDevicePairSetup: vi.fn(async () => true) },
    agentSelection: createAgentSelection(),
  } as unknown as ApplicationContext);
  const page = document.createElement("branch-apps-page") as AppsPageElement;
  host.append(page);
  document.body.append(host);
  await page.updateComplete;
  // Catalog and chrome-setup children may schedule updates.
  await page.updateComplete;
  return page;
}

function cardTitles(page: HTMLElement): string[] {
  return [...page.querySelectorAll(".apps-card h3")].map((el) => el.textContent?.trim() ?? "");
}

beforeEach(async () => {
  localStorage.removeItem(APPS_LEVEL_KEY);
  document.body.replaceChildren();
  await i18n.setLocale("en");
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.removeItem(APPS_LEVEL_KEY);
  vi.restoreAllMocks();
});

describe("branch-apps-page technical level wiring", () => {
  it("hides iPhone and the browser extension below Technical", async () => {
    localStorage.setItem(APPS_LEVEL_KEY, "regular");
    const page = await mountPage();
    const titles = cardTitles(page);
    expect(titles).not.toContain("iPhone");
    expect(titles).not.toContain("Chrome extension");
    expect(page.textContent).not.toContain(NOT_OUT_YET);
  });

  it("shows Not out yet for iPhone and the browser extension at Technical", async () => {
    localStorage.setItem(APPS_LEVEL_KEY, "technical");
    const page = await mountPage();
    expect(cardTitles(page)).toEqual(
      expect.arrayContaining(["iPhone", "Chrome extension", "Android", "macOS", "Windows", "Linux"]),
    );
    for (const title of ["iPhone", "Chrome extension"]) {
      const card = [...page.querySelectorAll(".apps-card")].find(
        (el) => el.querySelector("h3")?.textContent === title,
      );
      expect(card?.textContent).toContain(NOT_OUT_YET);
      expect(card?.querySelector("a.apps-card__cta, button.apps-card__cta")).toBeNull();
    }
  });
});
