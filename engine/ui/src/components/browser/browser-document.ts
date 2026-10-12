import type { ControlUiFocusTarget } from "@branch/session-url-contract";
import { html, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import type { ApplicationContext } from "../../app/context.ts";
import { resolveControlUiAuthToken } from "../../app/control-ui-auth.ts";
import { isBrowserPanelAvailable } from "../../app/panel-availability.ts";
import { t } from "../../i18n/index.ts";
import { BranchLightDomContentsElement } from "../../lit/branch-element.ts";
import { renderConnectingSplash } from "../loading-skeleton.ts";
import "./browser-panel.ts";
import { readBrowserTabTarget } from "./browser-target.ts";

type BrowserDocumentProps = {
  context: ApplicationContext;
  target: Extract<ControlUiFocusTarget, { kind: "browser" }>;
  renderEscape: (label: string) => TemplateResult | typeof nothing;
};

class BranchBrowserDocument extends BranchLightDomContentsElement {
  @property({ attribute: false }) props: BrowserDocumentProps | null = null;

  override render() {
    if (!this.props) {
      return nothing;
    }
    const { context, target, renderEscape } = this.props;
    const gatewaySnapshot = context.gateway.snapshot;
    const gatewayConnected = gatewaySnapshot.phase === "connected";
    const gatewayStartupStatus =
      gatewaySnapshot.phase === "starting" ? t("common.gatewayStarting") : undefined;
    const tab = readBrowserTabTarget(target.tab);
    const available = Boolean(tab && isBrowserPanelAvailable(gatewaySnapshot));
    return html`
      <branch-browser-panel
        embedded
        style=${available ? "height: 100dvh;" : "display: none;"}
        .client=${gatewayConnected ? gatewaySnapshot.client : null}
        .available=${available}
        .remoteAvailable=${available}
        .presented=${true}
        .sessionKey=${target.sessionKey}
        .fixedTab=${tab}
        .resourceBasePath=${context.resourceBasePath}
        .authToken=${resolveControlUiAuthToken({
          hello: gatewaySnapshot.hello,
          settings: { token: context.gateway.connection.token },
          password: context.gateway.connection.password,
        })}
      ></branch-browser-panel>
      ${!gatewayConnected && gatewaySnapshot.lastError === null ? renderConnectingSplash(gatewayStartupStatus) : nothing}
      ${
        !available && (gatewayConnected || gatewaySnapshot.lastError)
          ? html`<main class="connect-splash" role="status">
              <div class="stack">
                <span>${t(tab ? "browser.unavailable" : "focus.unsupported")}</span>
                ${renderEscape(t("common.back"))}
              </div>
            </main>`
          : nothing
      }
    `;
  }
}

if (!customElements.get("branch-browser-document")) {
  customElements.define("branch-browser-document", BranchBrowserDocument);
}

declare global {
  interface HTMLElementTagNameMap {
    "branch-browser-document": BranchBrowserDocument;
  }
}
