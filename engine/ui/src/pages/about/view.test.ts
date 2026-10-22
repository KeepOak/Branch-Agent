/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderAbout } from "./view.ts";

type AboutProps = Parameters<typeof renderAbout>[0];

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const COMMIT_AT = "2026-07-10T11:22:33.000Z";
const BUILT_AT = "2026-07-10T12:34:56.000Z";

function createProps(overrides: Partial<AboutProps> = {}): AboutProps {
  return {
    buildInfo: {
      version: "2026.7.10",
      commit: COMMIT,
      commitAt: COMMIT_AT,
      builtAt: BUILT_AT,
      branch: "feature/build-chip",
      dirty: true,
      release: false,
      buildId: "test",
    },
    gatewayVersion: "2026.7.9",
    copyState: "idle",
    onCopyCommit: vi.fn(),
    ...overrides,
  };
}

describe("renderAbout", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await i18n.setLocale("en");
  });

  it("renders the preview's small About dialog: leaf mark, identity, three links, licences", () => {
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

  it("keeps version, commit, branch, and localized UTC build date in one facts grid", () => {
    const container = document.createElement("div");
    render(renderAbout(createProps()), container);

    const facts = container.querySelector(".settings-kv");
    const values = facts?.querySelectorAll("dd");
    expect(facts?.tagName).toBe("DL");
    expect(facts?.hasAttribute("role")).toBe(false);
    expect(facts?.getAttribute("aria-label")).toBe("Control UI build details");
    expect(facts?.classList.contains("about-build-grid")).toBe(true);
    expect(values).toHaveLength(4);
    expect(values?.[0]?.textContent).toContain("2026.7.10");
    expect(values?.[1]?.querySelector("code")?.textContent).toBe(COMMIT.slice(0, 12));
    expect(values?.[1]?.querySelector("code")?.getAttribute("title")).toBe(COMMIT);
    expect(values?.[1]?.querySelector("code")?.getAttribute("dir")).toBe("ltr");

    const commitAge = values?.[1]?.querySelector("time.about-commit__age");
    expect(commitAge?.getAttribute("datetime")).toBe(COMMIT_AT);
    expect(commitAge?.textContent?.trim()).not.toBe("");
    expect(commitAge?.getAttribute("title")).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(COMMIT_AT),
      ),
    );
    expect(commitAge?.nextElementSibling?.tagName.toLowerCase()).toBe("branch-tooltip");

    expect(values?.[2]?.textContent).toContain("feature/build-chip*");

    const time = values?.[3]?.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe(BUILT_AT);
    expect(time?.getAttribute("title")).toBe(BUILT_AT);
    expect(time?.getAttribute("dir")).toBe("auto");
    expect(time?.textContent).toBe(
      new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(
        new Date(BUILT_AT),
      ),
    );
  });

  it("keeps the commit hash without an age when no commit timestamp is embedded", () => {
    const container = document.createElement("div");
    const props = createProps();
    render(renderAbout({ ...props, buildInfo: { ...props.buildInfo, commitAt: null } }), container);

    expect(container.querySelector(".about-commit code")?.textContent).toBe(COMMIT.slice(0, 12));
    expect(container.querySelector(".about-commit__age")).toBeNull();
  });

  it("keeps the connected Gateway version separate from the browser artifact", () => {
    const container = document.createElement("div");
    render(renderAbout(createProps()), container);

    expect(container.querySelector(".settings-kv")?.textContent).not.toContain("2026.7.9");
    const gatewayRow = container.querySelectorAll(".settings-row")[0];
    expect(gatewayRow?.textContent).toContain("2026.7.9");
    expect(gatewayRow?.textContent).toContain("separate from this Control UI build");
  });

  it("copies the full commit while announcing success accessibly", () => {
    const onCopyCommit = vi.fn();
    const container = document.createElement("div");
    render(renderAbout(createProps({ copyState: "copied", onCopyCommit })), container);

    const button = container.querySelector<HTMLButtonElement>(".about-commit button");
    expect(button?.getAttribute("aria-label")).toBe("Commit hash copied");
    expect(container.querySelector("[role='status']")?.textContent?.trim()).toBe(
      "Commit hash copied",
    );
    button?.click();
    expect(onCopyCommit).toHaveBeenCalledOnce();
  });

  it("states when artifact identity and Gateway version are unavailable", () => {
    const container = document.createElement("div");
    render(
      renderAbout(
        createProps({
          buildInfo: {
            version: null,
            commit: null,
            commitAt: null,
            builtAt: null,
            branch: null,
            dirty: null,
            release: false,
            buildId: "dev",
          },
          gatewayVersion: null,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".settings-kv .muted")).toHaveLength(3);
    expect(container.querySelector(".settings-row__value")?.textContent).toContain("Unavailable");
    expect(container.querySelector(".about-commit button")).toBeNull();
    expect(container.textContent).not.toContain("Unknown build");
  });
});
