import { html, nothing } from "lit";
import { inferControlUiPublicAssetPath } from "../../app/public-assets.ts";
import type { ControlUiBuildInfo } from "../../build-info.ts";
import { icons } from "../../components/icons.ts";
import "../../components/tooltip.ts";
import { renderSettingsRow, renderSettingsValue } from "../../components/settings-ui.ts";
import { i18n, t } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import { formatRelativeTimestamp } from "../../lib/format.ts";
import "../../styles/about.css";
import {
  BRANCH_HELP_URL,
  BRANCH_LICENCES_URL,
  BRANCH_RELEASES_URL,
  BRANCH_WEBSITE_URL,
} from "../../lib/product-links.ts";

export type AboutCommitCopyState = "idle" | "copying" | "copied" | "error";

type AboutProps = {
  buildInfo: ControlUiBuildInfo;
  gatewayVersion: string | null;
  copyState: AboutCommitCopyState;
  onCopyCommit: () => void;
};

const SHORT_COMMIT_LENGTH = 12;

// The preview's About dialog: keepoak.com, the Handbook and What's new; licences sit on the © line.
const ABOUT_LINKS: ReadonlyArray<{ href: string; label: () => string }> = [
  { href: BRANCH_WEBSITE_URL, label: () => t("aboutPage.linkWebsite") },
  { href: BRANCH_HELP_URL, label: () => t("aboutPage.linkDocs") },
  { href: BRANCH_RELEASES_URL, label: () => t("aboutPage.linkChangelog") },
];

function formatControlUiBuildDate(
  value: string | null,
  locales?: Intl.LocalesArgument,
): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locales, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function renderUnavailable() {
  return html`<span class="muted">${t("aboutPage.unavailable")}</span>`;
}

// Always-relative commit age; the exact localized timestamp lives on hover
// (title) so the row stays compact for any artifact age.
function renderCommitAge(commitAt: string | null) {
  if (!commitAt) {
    return nothing;
  }
  const timestamp = Date.parse(commitAt);
  if (!Number.isFinite(timestamp)) {
    return nothing;
  }
  const exact = new Intl.DateTimeFormat(i18n.getLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
  return html`
    <time class="about-commit__age" dir="auto" datetime=${commitAt} title=${exact}
      >${formatRelativeTimestamp(timestamp, { fallback: "" })}</time
    >
  `;
}

function renderCommit(props: AboutProps) {
  const commit = props.buildInfo.commit;
  if (!commit) {
    return renderUnavailable();
  }
  const label = t(
    {
      idle: "aboutPage.copyCommit",
      copying: "aboutPage.copyingCommit",
      copied: "aboutPage.copiedCommit",
      error: "aboutPage.copyCommitFailed",
    }[props.copyState],
  );
  return html`
    <span class="about-commit">
      <code dir="ltr" title=${commit}>${commit.slice(0, SHORT_COMMIT_LENGTH)}</code>
      ${renderCommitAge(props.buildInfo.commitAt)}
      <branch-tooltip .content=${label}>
        <button
          type="button"
          class="about-commit__copy"
          aria-label=${label}
          aria-busy=${props.copyState === "copying" ? "true" : nothing}
          ?disabled=${props.copyState === "copying"}
          @click=${props.onCopyCommit}
        >
          <span aria-hidden="true">${props.copyState === "copied" ? icons.check : icons.copy}</span>
        </button>
      </branch-tooltip>
      <span class="sr-only" role="status" aria-live="polite"
        >${props.copyState === "copied" || props.copyState === "error" ? label : ""}</span
      >
    </span>
  `;
}

function externalLink(href: string, label: string, className: string) {
  return html`<a
    class=${className}
    href=${href}
    target=${EXTERNAL_LINK_TARGET}
    rel=${buildExternalLinkRel()}
    >${label}</a
  >`;
}

// The Branch leaf mark (KeepOak app icon), the product line, and the three links (preview `ACTS.about`).
function renderHero(props: AboutProps) {
  const version = props.buildInfo.version;
  return html`
    <section class="about-hero">
      <img
        class="about-hero__mark"
        src=${inferControlUiPublicAssetPath("brand/keepoak-app-icon-512.png")}
        alt=""
        aria-hidden="true"
        width="84"
        height="84"
        draggable="false"
      />
      <div class="about-hero__id">
        <b class="about-hero__name">${t("aboutPage.productName")}</b>${
          version ? html` <code class="about-hero__version" dir="ltr">${version}</code>` : nothing
        }
        <p class="about-hero__tagline">${t("aboutPage.tagline")}</p>
        <p class="about-hero__byline">${t("aboutPage.byline")}</p>
      </div>
    </section>
    <nav class="about-hero__links" aria-label=${t("aboutPage.linksLabel")}>
      ${ABOUT_LINKS.map((link) => externalLink(link.href, link.label(), "about-hero__link"))}
    </nav>
    <p class="about-footer">
      ${t("aboutPage.license")} ·
      ${externalLink(BRANCH_LICENCES_URL, t("aboutPage.linkLicences"), "about-footer__licences")}
    </p>
  `;
}

export function renderAbout(props: AboutProps) {
  const buildDate = formatControlUiBuildDate(props.buildInfo.builtAt, i18n.getLocale());
  const buildFacts = html`
    <dl class="settings-kv about-build-grid" aria-label=${t("aboutPage.artifactDetails")}>
      <dt>${t("aboutPage.version")}</dt>
      <dd>
        ${
          props.buildInfo.version
            ? html`<code dir="ltr" title=${props.buildInfo.version}
                >${props.buildInfo.version}</code
              >`
            : renderUnavailable()
        }
      </dd>
      <dt>${t("aboutPage.commit")}</dt>
      <dd>${renderCommit(props)}</dd>
      ${
        props.buildInfo.branch
          ? html`
              <dt>${t("aboutPage.branch")}</dt>
              <dd>
                <code dir="ltr" title=${props.buildInfo.branch}
                  >${props.buildInfo.branch}${props.buildInfo.dirty === true ? "*" : ""}</code
                >
              </dd>
            `
          : nothing
      }
      <dt>${t("aboutPage.built")}</dt>
      <dd>
        ${
          buildDate && props.buildInfo.builtAt
            ? html`<time
                dir="auto"
                datetime=${props.buildInfo.builtAt}
                title=${props.buildInfo.builtAt}
                >${buildDate}</time
              >`
            : renderUnavailable()
        }
      </dd>
    </dl>
  `;
  return html`<section class="about-dialog" aria-labelledby="about-dialog-title">
    <h2 class="about-dialog__title" id="about-dialog-title">${t("aboutPage.title")}</h2>
    ${renderHero(props)}
    <h3 class="about-dialog__h">${t("aboutPage.buildDetails")}</h3>
    ${buildFacts}
    ${renderSettingsRow({
      title: t("aboutPage.gatewayVersion"),
      description: t("aboutPage.gatewayVersionHint"),
      control: props.gatewayVersion
        ? renderSettingsValue(
            html`<code dir="ltr" title=${props.gatewayVersion}>${props.gatewayVersion}</code>`,
            { mono: true },
          )
        : renderSettingsValue(t("aboutPage.unavailable")),
    })}
  </section>`;
}
