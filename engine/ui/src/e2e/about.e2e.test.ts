// Control UI tests cover the About Branch dialog against a mocked Gateway.
import { expect, it } from "vitest";
import { installMockGateway } from "../test-helpers/control-ui-e2e.ts";
import {
  createControlUiE2eContextOptions,
  createControlUiE2eSuite,
} from "./control-ui-e2e-suite.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI About mocked Gateway E2E",
  startServerBeforeBrowser: true,
  unavailableMessage: (executablePath) => `Playwright Chromium is unavailable at ${executablePath}`,
});

suite.define(() => {
  it("opens settings/about as the preview's small About dialog over Settings, closed by its X", async () => {
    const context = await suite.browser.newContext(createControlUiE2eContextOptions());
    const page = await context.newPage();
    await installMockGateway(page);

    try {
      const response = await page.goto(`${suite.server.baseUrl}settings/about`);
      expect(response?.status()).toBe(200);
      await page.getByRole("heading", { name: "Settings" }).waitFor();

      const aboutLink = page.getByRole("link", { name: "About", exact: true });
      await expect.poll(() => aboutLink.getAttribute("aria-current")).toBe("page");

      const dialog = page.locator(".about-dialog");
      await dialog.waitFor();
      await expect
        .poll(() => dialog.locator("#about-dialog-title").textContent())
        .toBe("About Branch");
      await expect
        .poll(() => dialog.locator(".about-hero__name").textContent())
        .toBe("Branch Agent");
      await expect
        .poll(() => dialog.locator(".about-hero__version").textContent())
        .toBe("2026.7.10");
      await expect
        .poll(() => dialog.locator(".about-hero__byline").textContent())
        .toMatch(/^By KeepOak · (macOS|Windows|Linux)$/u);
      await expect.poll(() => dialog.locator("img.about-hero__mark").count()).toBe(1);

      const handbook = dialog.getByRole("link", { name: "Handbook", exact: true });
      await expect.poll(() => handbook.getAttribute("href")).toBe("https://keepoak.com/help");
      await expect.poll(() => handbook.getAttribute("target")).toBe("_blank");
      await expect.poll(() => handbook.getAttribute("rel")).toContain("noopener");
      await expect.poll(() => dialog.locator(".about-hero__link").count()).toBe(3);
      // Plain text links like the preview's `.link`, not bordered pills.
      await expect
        .poll(() => handbook.evaluate((el) => getComputedStyle(el).textDecorationLine))
        .toContain("underline");
      await expect
        .poll(() => handbook.evaluate((el) => getComputedStyle(el).borderTopWidth))
        .toBe("0px");

      await expect
        .poll(() => dialog.locator(".about-footer").textContent())
        .toContain("Open-source licences");
      await expect
        .poll(() => page.locator('dl[aria-label="Control UI build details"]').count())
        .toBe(0);
      await expect
        .poll(() => page.locator(".settings-row", { hasText: "Connected Gateway version" }).count())
        .toBe(0);

      await page.setViewportSize({ height: 812, width: 375 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          ),
        )
        .toBeLessThanOrEqual(1);

      await dialog.getByRole("button", { name: "Close" }).click();
      await expect.poll(() => page.locator(".about-dialog").count()).toBe(0);
      await expect.poll(() => new URL(page.url()).pathname).not.toMatch(/\/about$/u);
    } finally {
      await context.close();
    }
  });
});
