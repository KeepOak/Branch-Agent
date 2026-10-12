import { html } from "lit";
import { property } from "lit/decorators.js";
import type { ControlUiEnvironment } from "../../../src/gateway/control-ui-bootstrap-contract.js";
import { beginNativeWindowDrag } from "../app/native-window-drag.ts";
import { controlUiPublicAssetPath } from "../app/public-assets.ts";
import { t } from "../i18n/index.ts";
import { BranchLightDomContentsElement } from "../lit/branch-element.ts";
import { icons } from "./icons.ts";
import { renderKbd, renderShortcutText } from "./kbd.ts";
import "./tooltip.ts";

/** Narrow-viewport header: drawer toggle, brand, and command-palette search.
 * Desktop hides it entirely (layout.css) — the sidebar owns navigation there. */
class AppTopbar extends BranchLightDomContentsElement {
  @property({ attribute: false }) navDrawerOpen = false;
  @property({ attribute: false }) resourceBasePath = "";
  @property({ attribute: false }) environment: ControlUiEnvironment | null = null;
  @property({ attribute: false }) onToggleDrawer!: (trigger: HTMLElement) => void;
  @property({ attribute: false }) onOpenPalette!: () => void;

  override render() {
    const drawerLabel = this.navDrawerOpen ? t("nav.collapse") : t("nav.expand");
    // The brand row asks the Mac host to drag the window, replacing its native drag strip.
    return html`
      <header class="topbar">
        <div class="topnav-shell">
          <branch-tooltip .content=${drawerLabel}>
            <button
              type="button"
              class="topbar-icon-btn topbar-nav-toggle"
              @click=${(event: MouseEvent) =>
                this.onToggleDrawer(event.currentTarget as HTMLElement)}
              aria-label=${drawerLabel}
              aria-expanded=${String(this.navDrawerOpen)}
            >
              <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
            </button>
          </branch-tooltip>
          <div class="topnav-shell__content" @mousedown=${beginNativeWindowDrag}>
            <div class="topbar-brand" aria-label="Branch Agent">
              <img
                class="topbar-brand__logo"
                src=${controlUiPublicAssetPath("apple-touch-icon.png", this.resourceBasePath)}
                loading="lazy"
                alt=""
                aria-hidden="true"
              />
              <span class="topbar-brand__title">Branch Agent</span>
              ${
                this.environment &&
                html`<span class="control-ui-environment-pill">${this.environment.label}</span>`
              }
            </div>
          </div>
          <div class="topnav-shell__actions">
            <branch-tooltip
              .content=${t("chat.commandPaletteTitle")}
              .contentTemplate=${renderShortcutText(t("chat.commandPaletteTitle").replace("⌘K", "{shortcut}"), renderKbd(["⌘", "K"], { inline: true }))}
            >
              <button
                class="topbar-search"
                @click=${this.onOpenPalette}
                aria-label=${t("chat.openCommandPalette")}
              >
                ${icons.search}
              </button>
            </branch-tooltip>
          </div>
        </div>
      </header>
    `;
  }
}

if (!customElements.get("branch-app-topbar")) {
  customElements.define("branch-app-topbar", AppTopbar);
}
