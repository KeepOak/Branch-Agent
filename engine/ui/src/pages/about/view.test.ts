/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { detectAboutPlatform, renderAbout } from "./view.ts";

type AboutProps = Parameters<typeof renderAbout>[0];

function createProps(overrides: Partial<AboutProps> = {}): AboutProps {
  return {
    buildInfo: { version: "2026.7.10" },
    platform: "macOS",
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("renderAbout", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await i18n.setLocale("en");
  });

  it("renders the preview's small About dialog: leaf mark, identity with platform, three links, licences", () => {
    const container = document.createElement("div");
    render(renderAbout(createProps()), container);

    const dialog = container.querySelector(".about-dialog");
    expect(dialog?.querySelector("#about-dialog-title")?.textContent).toBe("About Branch");
    const hero = container.querySelector(".about-hero");
    expect(hero?.querySelector(".about-hero__name")?.textContent).toBe("Branch Agent");
    expect(hero?.querySelector(".about-hero__version")?.textContent).toBe("2026.7.10");
    expect(hero?.querySelector("img.about-hero__mark")?.getAttribute("src")).toContain(
      "brand/keepoak-app-icon-512.png",
    );
    expect(hero?.querySelector("svg")).toBeNull();
    expect(hero?.querySelector(".about-hero__byline")?.textContent).toBe("By KeepOak · macOS");
    expect(container.querySelector(".about-hero__clawd")).toBeNull();
    expect(container.textContent).not.toContain("Clawd");

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(".about-hero__link"));
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute("href")])).toEqual([
      ["keepoak.com", "https://keepoak.com"],
      ["Handbook", "https://keepoak.com/help"],
      ["What’s new", "https://github.com/KeepOak/Branch-Agent/releases"],
    ]);
    const licences = container.querySelector<HTMLAnchorElement>(".about-footer__licences");
    expect(licences?.textContent?.trim()).toBe("Open-source licences");
    expect(licences?.getAttribute("href")).toBe(
      "https://github.com/KeepOak/Branch-Agent/blob/main/NOTICE",
    );
    for (const link of [...links, licences!]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
    }
    expect(container.innerHTML).not.toContain("x.com");
    expect(container.innerHTML).not.toContain("openclaw");
    expect(container.querySelector(".about-footer")?.textContent).toContain("© 2026 KeepOak");
  });

  it("has a close X in the dialog header and no build details or Gateway version", () => {
    const onClose = vi.fn();
    const container = document.createElement("div");
    render(renderAbout(createProps({ onClose })), container);

    const close = container.querySelector<HTMLButtonElement>(".about-dialog__h button");
    expect(close?.getAttribute("aria-label")).toBe("Close");
    close?.click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelector(".about-build-grid")).toBeNull();
    expect(container.querySelector(".settings-row")).toBeNull();
    expect(container.textContent).not.toContain("Build details");
    expect(container.textContent).not.toContain("Gateway");
    expect(container.textContent).not.toContain("Commit");
  });

  it("keeps the by-line plain when the platform is unknown, and the version optional", () => {
    const container = document.createElement("div");
    render(renderAbout(createProps({ platform: null, buildInfo: { version: null } })), container);
    expect(container.querySelector(".about-hero__byline")?.textContent).toBe("By KeepOak");
    expect(container.querySelector(".about-hero__version")).toBeNull();
  });

  it("names the platform the way the preview does", () => {
    expect(detectAboutPlatform({ platform: "MacIntel", userAgent: "" })).toBe("macOS");
    expect(detectAboutPlatform({ platform: "Win32", userAgent: "" })).toBe("Windows");
    expect(detectAboutPlatform({ platform: "Linux x86_64", userAgent: "" })).toBe("Linux");
    expect(detectAboutPlatform({ platform: "", userAgent: "" })).toBeNull();
  });
});
