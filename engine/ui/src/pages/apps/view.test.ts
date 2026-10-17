/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { buildMacGatewayLaunchUrl } from "./gateway-launch.ts";
import { BRANCH_DOWNLOAD_PAGES } from "./release-downloads.ts";
import { renderApps } from "./view.ts";

const LATEST = "https://github.com/KeepOak/Branch-Agent/releases/latest";
const RELEASES = "https://github.com/KeepOak/Branch-Agent/releases";
const EXPECTED_EXTERNAL_HREFS = [
  RELEASES,
  "https://docs.openclaw.ai/platforms/android",
  "https://docs.openclaw.ai/platforms/ios",
  "https://docs.openclaw.ai/platforms/android",
  LATEST,
  "https://docs.openclaw.ai/platforms/macos",
  LATEST,
  "https://docs.openclaw.ai/platforms/windows",
  LATEST,
  "https://docs.openclaw.ai/platforms/linux",
  "https://clawhub.ai",
  "https://discord.gg/clawd",
  "https://docs.openclaw.ai",
];
const NOT_OUT_YET = "Not out yet. Use the Android, Mac, Windows or Linux app for now.";

describe("renderApps", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await i18n.setLocale("en");
  });

  async function renderIntoContainer(
    onNavigate = vi.fn(),
    onPairDevice?: () => void,
    technical = false,
  ) {
    const container = document.body.appendChild(document.createElement("div"));
    render(renderApps({ onNavigate, onPairDevice, technical }), container);
    return container;
  }

  it("sends every Download to Branch's own release pages, never a store listing", () => {
    expect(BRANCH_DOWNLOAD_PAGES).toEqual({ mac: LATEST, windows: LATEST, linux: LATEST, android: RELEASES });
    for (const url of Object.values(BRANCH_DOWNLOAD_PAGES)) {
      expect(new URL(url).hostname).toBe("github.com");
      expect(new URL(url).pathname).toMatch(/^\/KeepOak\/Branch-Agent\/releases(\/latest)?$/);
    }
  });

  it("renders every external link in order with safe target and rel", async () => {
    const container = await renderIntoContainer();
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"));
    expect(anchors.map((anchor) => anchor.getAttribute("href"))).toEqual(EXPECTED_EXTERNAL_HREFS);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toContain("noopener");
      expect(anchor.getAttribute("rel")).toContain("noreferrer");
    }
  });

  it("navigates to the in-app Plugins hub from the plugins card", async () => {
    const onNavigate = vi.fn();
    const container = await renderIntoContainer(onNavigate);
    const buttons = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button.apps-card__cta"),
    );
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain("Open Plugins");
    buttons[0]?.click();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("plugins");
  });

  it("opens the connected Gateway in the Mac app without losing the download option", async () => {
    const container = document.body.appendChild(document.createElement("div"));
    render(
      renderApps({
        onNavigate: vi.fn(),
        macGatewayLaunchUrl: buildMacGatewayLaunchUrl("wss://research.example:8443/assistant"),
      }),
      container,
    );
    const launch = container.querySelector<HTMLAnchorElement>("a[href^='branch:']");
    expect(launch?.textContent?.trim()).toBe("Open in Mac app");
    const url = new URL(launch!.href);
    expect(url.host).toBe("gateway");
    expect(url.pathname).toBe("/add");
    expect([...url.searchParams]).toEqual([["url", "https://research.example:8443/assistant"]]);
    expect(launch?.getAttribute("target")).toBeNull();
    const card = launch?.closest(".apps-card");
    expect(card?.querySelector("h3")?.textContent).toBe("macOS");
    expect(card?.querySelector(`a[href='${LATEST}']`)?.textContent?.trim()).toBe("Download");
  });

  it("hides iPhone and the browser extension below Technical", async () => {
    const container = await renderIntoContainer();
    const titles = [...container.querySelectorAll(".apps-card h3")].map((el) => el.textContent);
    expect(titles).not.toContain("iPhone");
    expect(titles).not.toContain("Chrome extension");
    expect(container.textContent).not.toContain(NOT_OUT_YET);
  });

  it("says plainly that iPhone and the browser extension are not out yet, only at Technical, with no link and no button", async () => {
    const container = await renderIntoContainer(vi.fn(), undefined, true);
    for (const title of ["iPhone", "Chrome extension"]) {
      const card = [...container.querySelectorAll(".apps-card")].find(
        (el) => el.querySelector("h3")?.textContent === title,
      );
      expect(card?.textContent).toContain(NOT_OUT_YET);
      expect(card?.querySelector("a, button")).toBeNull();
    }
  });

  it("offers device pairing from the phone section only when permitted", async () => {
    const withoutPair = await renderIntoContainer();
    expect(withoutPair.querySelector(".apps-pair-hint")).toBeNull();

    const onPairDevice = vi.fn();
    const container = await renderIntoContainer(vi.fn(), onPairDevice);
    const hint = container.querySelector(".apps-pair-hint");
    expect(hint?.textContent).toContain("Already have the app?");
    hint?.querySelector("button")?.click();
    expect(onPairDevice).toHaveBeenCalledOnce();
  });

  it("renders decorative lazy card art with a per-theme variant for every card", async () => {
    const container = await renderIntoContainer();
    const images = Array.from(container.querySelectorAll<HTMLImageElement>(".apps-card__art img"));
    expect(images).toHaveLength(14);
    for (const image of images) {
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("loading")).toBe("lazy");
    }
    const lightSrcs = images
      .filter((image) => image.classList.contains("apps-card__art-img--light"))
      .map((image) => image.getAttribute("src"));
    const darkSrcs = images
      .filter((image) => image.classList.contains("apps-card__art-img--dark"))
      .map((image) => image.getAttribute("src"));
    expect(lightSrcs).toHaveLength(7);
    for (const src of lightSrcs) {
      expect(src).toMatch(/^\/app-art\/[a-z-]+\.webp$/);
    }
    expect(darkSrcs).toEqual(lightSrcs.map((src) => src?.replace(/\.webp$/, "-dark.webp")));
  });
});
