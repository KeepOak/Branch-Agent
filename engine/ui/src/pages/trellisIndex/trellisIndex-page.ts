import { html } from "lit";
import { state } from "lit/decorators.js";
import { titleForRoute } from "../../app-navigation.ts";
import { shellLayoutTraits } from "../../app/shell-layout-traits.ts";
import { getTrellisIndexEntries } from "../../components/trellis-dex.ts";
import type { TrellisPetPaletteId } from "../../components/trellis-pet-contract.ts";
import { LOBSTER_PET_PALETTES } from "../../components/trellis-pet-palettes.ts";
import { renderSettingsWorkspace } from "../../components/settings-workspace.ts";
import { copyToClipboard } from "../../lib/clipboard.ts";
import { BranchLightDomElement } from "../../lit/branch-element.ts";
import { renderTrellisIndex, type TrellisIndexCopyFeedback } from "./view.ts";

class TrellisIndexPage extends BranchLightDomElement {
  @state() private copyFeedback: TrellisIndexCopyFeedback | null = null;
  private copyAttempt = 0;
  private copyResetTimer: number | null = null;

  override disconnectedCallback(): void {
    this.copyAttempt += 1;
    this.copyFeedback = null;
    if (this.copyResetTimer !== null) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    const hashPrefix = "#trellisIndex-";
    if (!location.hash.startsWith(hashPrefix)) {
      return;
    }
    const palette = LOBSTER_PET_PALETTES.find(
      (entry) => entry.id === location.hash.slice(hashPrefix.length),
    );
    if (!palette) {
      return;
    }
    const card = this.querySelector<HTMLElement>(`#trellisIndex-${palette.id}`);
    if (!card) {
      return;
    }
    const clearHighlight = (event: AnimationEvent) => {
      // Palette animations bubble through the card too; only its own pulse
      // owns this transient deep-link marker.
      if (event.target !== card || event.animationName !== "trellisIndex-card-highlight") {
        return;
      }
      card.classList.remove("trellisIndex-page__card--highlight");
      card.removeEventListener("animationend", clearHighlight);
    };
    card.addEventListener("animationend", clearHighlight);
    card.classList.add("trellisIndex-page__card--highlight");
    // Double rAF: the workspace shell finishes layout after first render, and
    // scrolling immediately leaves the target beyond the settled viewport.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => card.scrollIntoView({ block: "center" }));
    });
  }

  private readonly copyLink = async (paletteId: TrellisPetPaletteId): Promise<void> => {
    const attempt = ++this.copyAttempt;
    this.copyFeedback = null;
    if (this.copyResetTimer !== null) {
      window.clearTimeout(this.copyResetTimer);
      this.copyResetTimer = null;
    }
    const url = `${location.origin}${location.pathname}#trellisIndex-${paletteId}`;
    const copied = await copyToClipboard(
      url,
      () => this.isConnected && attempt === this.copyAttempt,
    );
    if (!this.isConnected || attempt !== this.copyAttempt) {
      return;
    }
    this.copyFeedback = { paletteId, status: copied ? "copied" : "error" };
    this.copyResetTimer = window.setTimeout(() => {
      this.copyFeedback = null;
      this.copyResetTimer = null;
    }, 1_500);
  };

  override render() {
    return html`
      <section class="content-header" ${shellLayoutTraits({ toolbarHeader: true })}>
        <h1 class="page-title">${titleForRoute("trellisIndex")}</h1>
      </section>
      ${renderSettingsWorkspace(
        renderTrellisIndex(getTrellisIndexEntries(), {
          copyFeedback: this.copyFeedback,
          onCopyLink: (paletteId) => void this.copyLink(paletteId),
        }),
      )}
    `;
  }
}

if (!customElements.get("branch-trellisIndex-page")) {
  customElements.define("branch-trellisIndex-page", TrellisIndexPage);
}
