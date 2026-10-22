import { html, nothing } from "lit";
import { inferControlUiPublicAssetPath } from "../../app/public-assets.ts";
import type { ControlUiBuildInfo } from "../../build-info.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "../../lib/external-link.ts";
import "../../styles/about.css";
import {
  BRANCH_HELP_URL,
  BRANCH_LICENCES_URL,
  BRANCH_RELEASES_URL,
  BRANCH_WEBSITE_URL,
} from "../../lib/product-links.ts";

export type AboutPlatform = "macOS" | "Windows" | "Linux";

type AboutProps = {
  buildInfo: Pick<ControlUiBuildInfo, "version">;
  platform: AboutPlatform | null;
  onClose?: () => void;
};

// The preview's About dialog: keepoak.com, the Handbook and What's new; licences sit on the © line.
const ABOUT_LINKS: ReadonlyArray<{ href: string; label: () => string }> = [
  { href: BRANCH_WEBSITE_URL, label: () => t("aboutPage.linkWebsite") },
  { href: BRANCH_HELP_URL, label: () => t("aboutPage.linkDocs") },
  { href: BRANCH_RELEASES_URL, label: () => t("aboutPage.linkChangelog") },
];

/** The by-line's system name, as the preview writes it ("By KeepOak · macOS"). */
export function detectAboutPlatform(
  nav: Pick<Navigator, "platform" | "userAgent"> | undefined = globalThis.navigator,
): AboutPlatform | null {
  const hint = `${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`;
  if (/Mac/u.test(hint)) {
    return "macOS";
  }
  if (/Win/u.test(hint)) {
    return "Windows";
  }
  if (/Linux|X11/u.test(hint)) {
    return "Linux";
  }
  return null;
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

// Preview `ACTS.about` body: mark + identity (.about18u), the links, then the © line (.aboutline18u).
function renderBody(props: AboutProps) {
  const version = props.buildInfo.version;
  const byline = props.platform
    ? `${t("aboutPage.byline")} · ${props.platform}`
    : t("aboutPage.byline");
  return html`
    <div class="about-hero">
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
        <p class="about-hero__byline">${byline}</p>
      </div>
    </div>
    <nav class="about-hero__links" aria-label=${t("aboutPage.linksLabel")}>
      ${ABOUT_LINKS.map((link) => externalLink(link.href, link.label(), "about-hero__link"))}
    </nav>
    <p class="about-footer">
      ${t("aboutPage.license")} ·
      ${externalLink(BRANCH_LICENCES_URL, t("aboutPage.linkLicences"), "about-footer__licences")}
    </p>
  `;
}

// Preview `openDlg`: .dlg > .dlg-h (title + close X) > .dlg-b.
export function renderAbout(props: AboutProps) {
  return html`<section class="about-dialog" aria-labelledby="about-dialog-title">
    <div class="about-dialog__h">
      <h2 class="about-dialog__title" id="about-dialog-title">${t("aboutPage.title")}</h2>
      <button
        class="about-dialog__close"
        type="button"
        aria-label=${t("common.close")}
        @click=${() => props.onClose?.()}
      >
        <span aria-hidden="true">${icons.x}</span>
      </button>
    </div>
    <div class="about-dialog__b">${renderBody(props)}</div>
  </section>`;
}
