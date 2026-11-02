/* @vitest-environment jsdom */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { buildMacGatewayLaunchUrl } from "./gateway-launch.ts";
import { renderApps } from "./view.ts";

const upstreamName = /openclaw|clawhub|clawd/i;

function upstreamLinks(source: string): string[] {
  const links =
    source.match(/https?:\/\/[^\s"'`<>]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s"'`<>]*)?/gi) ?? [];
  return links.filter((link) => {
    const url = new URL(link.startsWith("http") ? link : `https://${link}`);
    return upstreamName.test(url.hostname + url.pathname);
  });
}

beforeEach(async () => {
  await i18n.setLocale("en");
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("apps page Branch links", () => {
  it.each([false, true])("has no upstream hrefs with technical=%s", (technical) => {
    const container = document.body.appendChild(document.createElement("div"));
    render(
      renderApps({
        technical,
        onNavigate: vi.fn(),
        onPairDevice: vi.fn(),
        macGatewayLaunchUrl: buildMacGatewayLaunchUrl("https://gateway.example"),
      }),
      container,
    );
    const hrefs = [...container.querySelectorAll("[href]")].map((el) => el.getAttribute("href")!);
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.filter((href) => upstreamName.test(href))).toEqual([]);
    for (const card of container.querySelectorAll(".apps-card")) {
      expect(card.querySelector("a, button, .apps-card__soon")).not.toBeNull();
    }
  });

  it("has no upstream URLs or bare hosts in any non-test apps source", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    const findings = files.flatMap((name) =>
      upstreamLinks(readFileSync(path.join(dir, name), "utf8")).map((link) => `${name}: ${link}`),
    );
    expect(findings).toEqual([]);
  });

  it("ignores package imports but flags upstream URL hosts and paths", () => {
    const source = 'import { definePage } from "@openclaw/uirouter";';
    expect(upstreamLinks(source)).toEqual([]);
    for (const link of [
      "https://docs.openclaw.ai/platforms/android",
      "http://clawhub.ai",
      "docs.openclaw.ai",
      "clawhub.ai",
      "discord.gg/clawd",
      "https://example.com/openclaw/help",
      "https://DOCS.OPENCLAW.AI",
    ]) {
      expect(upstreamLinks(`${source}\nconst href = "${link}";`)).toEqual([link]);
    }
  });
});
