import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { About } from "../places/settings/set2/updates";
import { SetupBrand, WelcomeHero } from "../setup/SetupBrand";

describe("Keeper identity in the window", () => {
  it("renders the About and setup rail marks in currentColor without an icon tile or mascot", () => {
    for (const markup of [renderToStaticMarkup(<About />), renderToStaticMarkup(<SetupBrand />)]) {
      expect(markup).toContain('fill="currentColor"');
      expect(markup).toContain("keepoak-mark-mono-white-1024.png");
      expect(markup).not.toContain("branch-mark.png");
      expect(markup).not.toContain("branch-wave.webp");
      expect(markup).not.toContain("background:");
    }
  });
  // The preview's Welcome tile (.obMarkP37) is the KeepOak app icon, drawn by setup-card.css.
  it("renders the setup Welcome mark as the app-icon tile, not the old mark or mascot", () => {
    const markup = renderToStaticMarkup(<WelcomeHero />);
    expect(markup).toContain('class="ob-mark"');
    expect(markup).not.toContain("branch-mark.png");
    expect(markup).not.toContain("branch-wave.webp");
    expect(markup).not.toContain("background:");
  });
});
