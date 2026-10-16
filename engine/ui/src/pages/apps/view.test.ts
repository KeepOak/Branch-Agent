/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { buildMacGatewayLaunchUrl } from "./gateway-launch.ts";
import { useReleaseListingsForTests, type ReleaseListing } from "./release-downloads.ts";
import { renderApps } from "./view.ts";

const version = "0.4.4-build-2d76db0056f8";
const download = (name: string) =>
  `https://github.com/KeepOak/Branch-Agent/releases/download/v${version}/${name}`;
const asset = (name: string) => ({ name, browser_download_url: download(name) });
const RELEASES: ReleaseListing[] = [
  {
    assets: [
      asset(`Branch-Agent-${version}-darwin-arm64.dmg`),
      asset(`Branch-Agent-Setup-${version}-win32-x64.exe`),
      asset(`Branch-Agent-${version}-linux-x64.AppImage`),
      { name: "Branch-macOS.dmg", browser_download_url: download("Branch-macOS.dmg") },
      { name: "Branch-Setup-Windows.exe", browser_download_url: download("Branch-Setup-Windows.exe") },
      { name: "Branch-Linux.deb", browser_download_url: download("Branch-Linux.deb") },
    ],
  },
  {
    assets: [
      asset(`branch-android-${version}-unsigned.apk`),
      asset(`branch-android-${version}.apk`),
    ],
  },
];
const MAC_DMG = download(`Branch-Agent-${version}-darwin-arm64.dmg`);
const EXPECTED_EXTERNAL_HREFS = [
  download(`branch-android-${version}.apk`),
  "https://docs.openclaw.ai/platforms/android",
  "https://docs.openclaw.ai/platforms/ios",
  "https://docs.openclaw.ai/platforms/android",
  MAC_DMG,
  "https://docs.openclaw.ai/platforms/macos",
  download(`Branch-Agent-Setup-${version}-win32-x64.exe`),
  "https://docs.openclaw.ai/platforms/windows",
  download(`Branch-Agent-${version}-linux-x64.AppImage`),
  "https://docs.openclaw.ai/platforms/linux",
  "https://clawhub.ai",
  "https://discord.gg/clawd",
  "https://docs.openclaw.ai",
];

describe("renderApps", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    useReleaseListingsForTests(RELEASES);
    await i18n.setLocale("en");
  });
  afterEach(() => {
    useReleaseListingsForTests(undefined);
  });

  async function settleDownloads(container: ParentNode) {
    const downloads = [
      ...container.querySelectorAll<HTMLElement & { updateComplete: Promise<boolean> }>(
        "branch-release-download",
      ),
    ];
    await Promise.all(downloads.map((el) => el.updateComplete));
  }

  async function renderIntoContainer(onNavigate = vi.fn(), onPairDevice?: () => void) {
    const container = document.body.appendChild(document.createElement("div"));
    render(renderApps({ onNavigate, onPairDevice }), container);
    await settleDownloads(container);
    return container;
  }

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
    await settleDownloads(container);
    const launch = container.querySelector<HTMLAnchorElement>("a[href^='branch:']");
    expect(launch?.textContent?.trim()).toBe("Open in Mac app");
    const url = new URL(launch!.href);
    expect(url.host).toBe("gateway");
    expect(url.pathname).toBe("/add");
    expect([...url.searchParams]).toEqual([["url", "https://research.example:8443/assistant"]]);
    expect(launch?.getAttribute("target")).toBeNull();
    const card = launch?.closest(".apps-card");
    expect(card?.querySelector("h3")?.textContent).toBe("macOS");
    expect(card?.querySelector(`a[href='${MAC_DMG}']`)?.textContent?.trim()).toBe("Download");
  });

  it("shows Coming soon for iPhone and the browser extension, with no link and no button", async () => {
    const container = await renderIntoContainer();
    for (const title of ["iPhone", "Chrome extension"]) {
      const card = [...container.querySelectorAll(".apps-card")].find(
        (el) => el.querySelector("h3")?.textContent === title,
      );
      expect(card?.textContent).toContain("Coming soon");
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
    expect(images).toHaveLength(18);
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
    expect(lightSrcs).toHaveLength(9);
    for (const src of lightSrcs) {
      expect(src).toMatch(/^\/app-art\/[a-z-]+\.webp$/);
    }
    expect(darkSrcs).toEqual(lightSrcs.map((src) => src?.replace(/\.webp$/, "-dark.webp")));
  });
});
