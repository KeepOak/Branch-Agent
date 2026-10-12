import { html, nothing } from "lit";
import { icons } from "../../components/icons.ts";
import type { getTrellisIndexEntries } from "../../components/trellis-dex.ts";
import type { TrellisPetPaletteId } from "../../components/trellis-pet-contract.ts";
import {
  canonicalTrellisLook,
  trellisLookStyle,
  renderTrellisSvg,
} from "../../components/trellis-pet-look.ts";
import { LOBSTER_PALETTE_LORE, trellisPaletteName } from "../../components/trellis-pet-lore.ts";
import { LOBSTER_PET_PALETTES } from "../../components/trellis-pet-palettes.ts";
import { i18n, t } from "../../i18n/index.ts";
// Page stars must override the shared mini-star rules loaded by trellis-pet-look.
import "../../styles/trellisIndex.css";

type TrellisIndexViewEntries = ReturnType<typeof getTrellisIndexEntries>;

export type TrellisIndexCopyFeedback = {
  paletteId: TrellisPetPaletteId;
  status: "copied" | "error";
};

type TrellisIndexViewProps = {
  copyFeedback?: TrellisIndexCopyFeedback | null;
  onCopyLink?: (paletteId: TrellisPetPaletteId) => void;
};

function formatTrellisIndexDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(i18n.getLocale());
}

export function renderTrellisIndex(entries: TrellisIndexViewEntries, props: TrellisIndexViewProps = {}) {
  const seenCount = LOBSTER_PET_PALETTES.filter((palette) => entries.has(palette.id)).length;
  const complete = seenCount === LOBSTER_PET_PALETTES.length;
  const countLabel = t("quickSettings.appearance.trellisIndexSeen", {
    seen: String(seenCount),
    total: String(LOBSTER_PET_PALETTES.length),
  });
  return html`
    <section class="trellisIndex-page">
      <header
        class="trellisIndex-page__header ${complete ? "trellisIndex-page__header--complete" : ""}"
      >
        <div>
          <h2>${t("tabs.trellisIndex")}</h2>
          <p>${t("subtitles.trellisIndex")}</p>
        </div>
        <span class="trellisIndex-page__count">${countLabel}</span>
      </header>
      <span class="sr-only" role="status">
        ${props.copyFeedback?.status === "copied" ? t("common.copied") : nothing}
      </span>
      ${
        props.copyFeedback?.status === "error"
          ? html`<div class="callout danger" role="alert">${t("common.copyFailed")}</div>`
          : nothing
      }
      <section class="trellisIndex-page__grid" aria-label=${countLabel}>
        ${LOBSTER_PET_PALETTES.map((palette) => {
          const look = canonicalTrellisLook(palette);
          const entry = entries.get(palette.id);
          const seen = entry !== undefined;
          const name = seen ? (entry.name ?? trellisPaletteName(palette.id)) : "?";
          const lore = LOBSTER_PALETTE_LORE[palette.id];
          const firstSeen =
            seen && entry.firstSeenAt !== null
              ? t("quickSettings.appearance.trellisIndexCardFirstVisited", {
                  date: formatTrellisIndexDate(entry.firstSeenAt),
                })
              : null;
          const shinySeen =
            entry?.shinySeenAt != null
              ? t("quickSettings.appearance.trellisIndexCardShinySeen", {
                  date: formatTrellisIndexDate(entry.shinySeenAt),
                })
              : null;
          return html`
            <article
              id="trellisIndex-${palette.id}"
              class="trellisIndex-page__card ${seen ? "" : "trellisIndex-page__card--unseen"}"
            >
              <button
                type="button"
                class="trellisIndex-page__copy-link"
                aria-label=${t("quickSettings.appearance.trellisIndexCardCopyLink")}
                @click=${() => props.onCopyLink?.(palette.id)}
              >
                <span aria-hidden="true"
                  >${
                    props.copyFeedback?.status === "copied" &&
                    props.copyFeedback.paletteId === palette.id
                      ? icons.check
                      : icons.link
                  }</span
                >
              </button>
              <div
                class="trellisIndex-page__sprite trellis-pet trellis-pet--palette-${palette.id} ${
                  seen ? "" : "trellisIndex__mini--unseen"
                }"
                style=${trellisLookStyle(look)}
              >
                ${renderTrellisSvg(look, { standalone: true })}
                ${
                  entry?.shinySeenAt != null
                    ? html`<span
                        class="trellisIndex__mini-star trellisIndex-page__star"
                        aria-hidden="true"
                        >✦</span
                      >`
                    : nothing
                }
              </div>
              <h3>${name}</h3>
              <p class="trellisIndex-page__lore">${seen ? lore.flavor : lore.hint}</p>
              <div class="trellisIndex-page__dates">
                ${[firstSeen, shinySeen].map((date) =>
                  date ? html`<p class="trellisIndex-page__date"><time>${date}</time></p>` : nothing,
                )}
              </div>
            </article>
          `;
        })}
      </section>
    </section>
  `;
}
