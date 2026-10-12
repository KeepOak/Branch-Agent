import { html, nothing } from "lit";
import { property } from "lit/decorators.js";
import { pathForRoute } from "../app-route-paths.ts";
import { CONTROL_UI_BUILD_INFO } from "../build-info.ts";
import { t } from "../i18n/index.ts";
import { shouldHandleNavigationClick } from "../lib/navigation-click.ts";
import { BranchLightDomContentsElement } from "../lit/branch-element.ts";
import {
  formatSettingsBuildLabel,
  formatSidebarBuildSubtitle,
  renderSidebarServerDetails,
} from "./sidebar-build-chip-format.ts";
import "./tooltip.ts";

class SidebarBuildChip extends BranchLightDomContentsElement {
  @property({ attribute: false }) basePath = "";
  @property({ attribute: false }) gatewayVersion: string | null = null;
  @property({ attribute: false }) updateAttentionDismissed = false;
  @property({ attribute: false }) onNavigate?: (routeId: "about") => void;
  @property({ attribute: false }) variant: "identity" | "settings" = "identity";

  override render() {
    const text =
      this.variant === "settings" || this.updateAttentionDismissed
        ? formatSettingsBuildLabel(CONTROL_UI_BUILD_INFO, this.gatewayVersion)
        : formatSidebarBuildSubtitle(CONTROL_UI_BUILD_INFO);
    if (!text && !this.updateAttentionDismissed) {
      return nothing;
    }
    return html`
      <branch-tooltip class="sidebar-hover-tooltip" .delay=${600} .closeDelay=${300}>
        <a
          class="sidebar-footer-build"
          href=${pathForRoute("about", this.basePath)}
          role=${this.variant === "identity" ? "menuitem" : nothing}
          aria-label=${
            this.updateAttentionDismissed
              ? `${t("aboutPage.artifactDetails")}. ${t("updates.sidebar.availableTitle")}`
              : t("aboutPage.artifactDetails")
          }
          @click=${(event: MouseEvent) => {
            if (!shouldHandleNavigationClick(event)) {
              return;
            }
            event.preventDefault();
            this.onNavigate?.("about");
          }}
          >${text ? html`<span class="sidebar-footer-build__text">${text}</span>` : nothing}
          ${
            this.updateAttentionDismissed
              ? html`<span class="agent-select__badge sidebar-footer-build__update"
                  >${t("updates.sidebar.availableTitle")}</span
                >`
              : nothing
          }</a
        >
        <div slot="content" class="sidebar-hover-card sidebar-build-hover-card">
          ${renderSidebarServerDetails(CONTROL_UI_BUILD_INFO, this.gatewayVersion)}
        </div>
      </branch-tooltip>
    `;
  }
}

if (globalThis.customElements && !customElements.get("branch-sidebar-build-chip")) {
  customElements.define("branch-sidebar-build-chip", SidebarBuildChip);
}
