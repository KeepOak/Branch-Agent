import { consume } from "@lit/context";
import { html } from "lit";
import { applicationContext, type ApplicationContext } from "../../app/context.ts";
import { CONTROL_UI_BUILD_INFO } from "../../build-info.ts";
import { t } from "../../i18n/index.ts";
import "../../components/modal-dialog.ts";
import { BranchLightDomElement } from "../../lit/branch-element.ts";
import { detectAboutPlatform, renderAbout } from "./view.ts";

// Settings page About returns to when its dialog closes.
const ABOUT_CLOSE_ROUTE = "profile";

/**
 * The About route draws the preview's small About Branch dialog over Settings
 * (spec-v23 `ACTS.about` via `openDlg`). Closing it replaces the About route with Settings.
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
    // Replace like the credential cleanup does: history.back() could leave the app
    // when About was opened directly, since a non-null history state or a native
    // embed's initial blank entry does not prove an in-app page to go back to.
    this.context.replace(ABOUT_CLOSE_ROUTE);
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
