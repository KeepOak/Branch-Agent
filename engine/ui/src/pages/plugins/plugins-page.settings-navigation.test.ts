/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
import {
  createClient,
  createContext,
  createGateway,
  createInspectResult,
  createPluginsRouteData,
  createPluginsRouteLocation,
  createResult,
  mountPage,
  resetPluginsPageTestState,
} from "./plugins-page.test-support.ts";

describe("PluginsPage settings navigation", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(resetPluginsPageTestState);

  it.each([
    {
      label: "Settings",
      route: "/settings/plugins/canopy",
      target: "plugin-settings" as const,
      pathname: "/settings/plugins",
      href: "/settings/plugins",
    },
    {
      label: "Plugins",
      route: "/settings/plugins/canopy?from=plugins",
      target: "plugins" as const,
      pathname: "/plugins",
      href: "/plugins",
    },
  ])("opens a settings detail with its $label breadcrumb", async (testCase) => {
    const { client, request } = createClient(async (method) =>
      method === "plugins.inspect" ? createInspectResult() : createResult(),
    );
    const harness = createGateway(client);
    const context = createContext(harness.gateway);
    const routeData = createPluginsRouteData(
      harness.gateway,
      createResult(),
      createPluginsRouteLocation(testCase.route),
    );
    const { page } = await mountPage(context, routeData, "settings");

    await vi.waitFor(() => {
      expect(page.querySelector("h1")?.textContent).toContain("Canopy");
    });
    expect(request).toHaveBeenCalledWith("plugins.inspect", { pluginId: "canopy" });

    const breadcrumb = page.querySelector<HTMLAnchorElement>(
      ".plugins-settings-breadcrumb__parent",
    );
    expect(breadcrumb?.textContent).toBe(testCase.label);
    expect(breadcrumb?.getAttribute("href")).toBe(testCase.href);
    expect(page.querySelector('[aria-current="page"]')?.textContent).toBe("Canopy");
    expect(page.querySelector("branch-plugin-manager")).toBeNull();
    const hero = page.querySelector(".plugin-catalog-detail__hero");
    expect(page.querySelector(".plugin-catalog-detail--no-sidebar")).not.toBeNull();
    expect(hero?.querySelector(".plugin-catalog-detail__sidebar")).toBeNull();
    expect(hero?.querySelector(".plugin-catalog-detail__icon")).not.toBeNull();
    expect(hero?.querySelector(".plugin-catalog-detail__publisher-icon")).toBeNull();
    expect(hero?.querySelector("h1")?.textContent).toBe("Canopy");
    expect(hero?.querySelector(".plugin-catalog-detail__summary")?.textContent).toBe(
      t("subtitles.canopy"),
    );
    expect(hero?.querySelector('[aria-label="Enable Canopy"]')).not.toBeNull();
    breadcrumb?.click();
    await page.updateComplete;
    expect(context.navigate).toHaveBeenCalledWith(testCase.target, {
      pathname: testCase.pathname,
    });
  });
});
