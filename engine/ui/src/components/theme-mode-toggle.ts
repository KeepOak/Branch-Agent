import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import type { ThemeMode } from "../app/theme.ts";
import { t } from "../i18n/index.ts";
import { BranchLightDomContentsElement } from "../lit/branch-element.ts";
import { icons } from "./icons.ts";
import "./tooltip.ts";

export type ThemeModeChangeDetail = {
  mode: ThemeMode;
  element: HTMLElement;
};

class ThemeModeToggle extends BranchLightDomContentsElement {
  @property({ attribute: false }) mode: ThemeMode = "system";
  @property({ attribute: false }) menuItem = false;

  private readonly handleModeChange = (event: Event) => {
    const mode = this.mode === "system" ? "light" : this.mode === "light" ? "dark" : "system";
    this.dispatchEvent(
      new CustomEvent<ThemeModeChangeDetail>("theme-change", {
        detail: { mode, element: event.currentTarget as HTMLElement },
        bubbles: true,
        composed: true,
      }),
    );
  };

  override render() {
    const labelKey =
      this.mode === "system"
        ? "common.system"
        : this.mode === "light"
          ? "common.light"
          : "common.dark";
    const label = t(labelKey);
    const tooltip = t("common.colorModeOption", { mode: label });

    return html`
      <branch-tooltip .content=${tooltip}>
        <button
          type="button"
          class="theme-mode-toggle"
          role=${this.menuItem ? "menuitem" : nothing}
          aria-label=${tooltip}
          @click=${this.handleModeChange}
        >
          ${this.mode === "system" ? icons.monitor : this.mode === "light" ? icons.sun : icons.moon}
        </button>
      </branch-tooltip>
    `;
  }
}

if (!customElements.get("branch-theme-mode-toggle")) {
  customElements.define("branch-theme-mode-toggle", ThemeModeToggle);
}
