import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { About } from "../places/settings/set2/updates";
import { SetupBrand, WelcomeHero } from "../setup/SetupBrand";

describe("Keeper identity in the window", () => {
  it("renders the About and setup welcome marks in currentColor without an icon tile or mascot", () => {
    for (const markup of [renderToStaticMarkup(<About />), renderToStaticMarkup(<SetupBrand />), renderToStaticMarkup(<WelcomeHero />)]) {
      expect(markup).toContain('fill="currentColor"');
      expect(markup).toContain("keepoak-mark-mono-white-1024.png");
      expect(markup).not.toContain("branch-mark.png");
      expect(markup).not.toContain("branch-wave.webp");
      expect(markup).not.toContain("background:");
    }
  });
});
