import { consume } from "@lit/context";
import { html } from "lit";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { CONTROL_UI_BUILD_INFO } from "../../build-info.ts";
import { t } from "../../i18n/index.ts";
import "../../components/modal-dialog.ts";
import { BranchLightDomElement } from "../../lit/branch-element.ts";
import { detectAboutPlatform, renderAbout } from "./view.ts";

// Settings fallback when About was opened directly (no in-app page to go back to).
const ABOUT_CLOSE_FALLBACK_ROUTE = "profile";

/**
 * The About route draws the preview's small About Branch dialog over Settings
 * (spec-v23 `ACTS.about` via `openDlg`). Closing it returns to where it was opened from.
 */
class AboutPage extends BranchLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  private closing = false;

  private close = (event?: Event) => {
    event?.preventDefault();
    if (this.closing) {
      return;
    }
    this.closing = true;
    // Only app-owned pushes carry a history state object (app/browser.ts), so a
    // null state means About was the first page: fall back to Settings instead.
    if (globalThis.history.state !== null && globalThis.history.length > 1) {
      globalThis.history.back();
      return;
    }
    this.context.replace(ABOUT_CLOSE_FALLBACK_ROUTE);
  };

  override render() {
    return html`
      <branch-modal-dialog
        class="about-modal"
        .label=${t("aboutPage.title")}
        @modal-cancel=${this.close}
      >
        ${renderAbout({
          buildInfo: CONTROL_UI_BUILD_INFO,
          platform: detectAboutPlatform(),
          onClose: () => this.close(),
        })}
      </branch-modal-dialog>
    `;
  }
}

if (!customElements.get("branch-about-page")) {
  customElements.define("branch-about-page", AboutPage);
}
