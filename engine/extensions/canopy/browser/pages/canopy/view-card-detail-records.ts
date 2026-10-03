import type { CanopyRunAttempt, CanopyProof } from "@branch/canopy-contract";
import { html, nothing } from "lit";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { formatUiExternalText } from "../../lib/format-error.ts";
import type { CanopyCard, CanopyDependencyState } from "../../lib/canopy/index.ts";
import { formatStatusLabel, formatUpdatedTime } from "./view-helpers.ts";

export function renderDependencyDetailList(dependencies: CanopyDependencyState) {
  if (dependencies.parents.length === 0) {
    return nothing;
  }
  return html`
    <section class="canopy-detail__section">
      <h3>${t("canopy.dependencies")}</h3>
      <ul class="canopy-detail__list canopy-detail__dependencies">
        ${dependencies.parents.map(
          (parent) => html`
            <li class=${parent.done ? "is-done" : "is-blocked"}>
              ${
                parent.done
                  ? html`<span class="canopy-detail__dependency-spacer"></span>`
                  : icons.alertTriangle
              }
              <span>${parent.title}</span>
              <span>
                ${
                  parent.missing
                    ? t("canopy.dependencyStatusMissing")
                    : parent.status
                      ? formatStatusLabel(parent.status)
                      : t("canopy.unknownStatus")
                }
              </span>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}

export function renderDetailRow(label: string, value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return nothing;
  }
  const text = String(value).trim();
  if (!text) {
    return nothing;
  }
  return html`
    <div class="canopy-detail__row">
      <span>${label}</span>
      <strong>${text}</strong>
    </div>
  `;
}

function renderDetailList(title: string, values: readonly string[]) {
  const entries = values.map((value) => value.trim()).filter(Boolean);
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <section class="canopy-detail__section">
      <h3>${title}</h3>
      <ol class="canopy-detail__list">
        ${entries.map((entry) => html`<li>${entry}</li>`)}
      </ol>
    </section>
  `;
}

function renderDetailTime(value: number | undefined) {
  const label = formatUpdatedTime(value);
  if (value === undefined || !label) {
    return nothing;
  }
  return html`<time class="canopy-detail__record-date" datetime=${new Date(value).toISOString()}
    >${label}</time
  >`;
}

function renderAttemptDetails(attempts: readonly CanopyRunAttempt[]) {
  if (!attempts.length) {
    return nothing;
  }
  const statusKeys: Record<CanopyRunAttempt["status"], string> = {
    running: "canopy.lifecycleRunning",
    succeeded: "canopy.lifecycleDone",
    failed: "canopy.lifecycleFailed",
    blocked: "canopy.status.blocked",
    stopped: "canopy.lifecycleStopped",
  };
  return html`<section class="canopy-detail__section">
    <h3>${t("canopy.badgeAttempts", { count: String(attempts.length) })}</h3>
    <ol class="canopy-detail__records">
      ${attempts.map((entry, index) => {
        const started = renderDetailTime(entry.startedAt);
        const ended = renderDetailTime(entry.endedAt);
        return html`<li>
          <div class="canopy-detail__record-heading">
            <strong>${t("canopy.detailAttemptTitle", { number: String(index + 1) })}</strong>
            <span>${t(statusKeys[entry.status])}</span>
          </div>
          ${entry.model ? html`<p>${entry.model}</p>` : nothing}
          ${
            entry.sessionKey
              ? html`<p class="canopy-detail__record-reference">${entry.sessionKey}</p>`
              : nothing
          }
          ${entry.error ? html`<p>${formatUiExternalText(entry.error)}</p>` : nothing}
          <div class="canopy-detail__record-date">
            ${started}${started !== nothing && ended !== nothing ? " → " : nothing}${ended}
          </div>
        </li>`;
      })}
    </ol>
  </section>`;
}

function renderProofDetails(proof: readonly CanopyProof[]) {
  if (!proof.length) {
    return nothing;
  }
  const statusKeys: Record<CanopyProof["status"], string> = {
    passed: "canopy.proofPassed",
    failed: "canopy.lifecycleFailed",
    skipped: "canopy.proofSkipped",
    unknown: "canopy.proofUnknown",
  };
  return html`<section class="canopy-detail__section">
    <h3>${t("canopy.detailProof")}</h3>
    <ol class="canopy-detail__records">
      ${proof.map(
        (entry) => html`<li>
          <div class="canopy-detail__record-heading">
            <strong>${entry.label || t("canopy.detailProof")}</strong>
            <span>${t(statusKeys[entry.status])}</span>
          </div>
          ${entry.command ? html`<code>${entry.command}</code>` : nothing}
          ${
            entry.url
              ? html`<p class="canopy-detail__record-reference">${entry.url}</p>`
              : nothing
          }
          ${entry.note ? html`<p>${entry.note}</p>` : nothing} ${renderDetailTime(entry.createdAt)}
        </li>`,
      )}
    </ol>
  </section>`;
}

function joinDetailParts(...values: unknown[]): string {
  return values.filter(Boolean).join(" - ");
}

function detailValues<T>(entries: readonly T[], ...fields: Array<keyof T>): string[] {
  return entries.map((entry) => joinDetailParts(...fields.map((field) => entry[field])));
}

function getDetailSections(card: CanopyCard) {
  const links = card.metadata?.links ?? [];
  const artifacts = card.metadata?.artifacts ?? [];
  const attachments = card.metadata?.attachments ?? [];
  const diagnostics = card.metadata?.diagnostics ?? [];
  const workerLogs = card.metadata?.workerLogs ?? [];
  const workerProtocol = card.metadata?.workerProtocol;
  const detailSections: Array<readonly [string, readonly string[]]> = [
    [
      t("canopy.badgeLinks", { count: String(links.length) }),
      detailValues(links, "type", "title", "targetCardId", "url"),
    ],
    [
      t("canopy.badgeArtifacts", { count: String(artifacts.length) }),
      detailValues(artifacts, "label", "url", "path", "mimeType"),
    ],
    [
      t("canopy.badgeAttachments", { count: String(attachments.length) }),
      detailValues(attachments, "fileName", "mimeType", "note"),
    ],
    [
      t("canopy.detailDiagnostics"),
      diagnostics.map((entry) =>
        joinDetailParts(
          `${entry.severity}: ${formatUiExternalText(entry.title)}`,
          formatUiExternalText(entry.detail),
          t("canopy.detailOccurrences", { count: String(entry.count) }),
          t("canopy.detailFirstSeen", { time: formatUpdatedTime(entry.firstSeenAt) }),
          t("canopy.detailLastSeen", { time: formatUpdatedTime(entry.lastSeenAt) }),
        ),
      ),
    ],
    [
      t("canopy.detailWorkerLogs"),
      workerLogs.map((entry) => `${entry.level}: ${formatUiExternalText(entry.message)}`),
    ],
    [
      t("canopy.detailWorkerProtocol"),
      workerProtocol
        ? [
            workerProtocol.state,
            formatUiExternalText(workerProtocol.detail),
            workerProtocol.updatedAt
              ? t("canopy.detailUpdatedValue", {
                  time: formatUpdatedTime(workerProtocol.updatedAt),
                })
              : "",
          ]
        : [],
    ],
  ];
  return detailSections;
}

export function renderTechnicalDetails(
  card: CanopyCard,
  linkedSessionKey: string | undefined,
  active: boolean,
) {
  const attempts = card.metadata?.attempts ?? [];
  const proof = card.metadata?.proof ?? [];
  const automation = card.metadata?.automation;
  const metadata = card.metadata;
  const notifications = metadata?.notifications ?? [];
  const metadataFields: Array<readonly [string, string | number | undefined]> = [
    [
      t("canopy.detailTemplate"),
      metadata?.templateId ? t(`canopy.template.${metadata.templateId}`) : undefined,
    ],
    [t("canopy.detailFailures"), metadata?.failureCount],
    [
      t("canopy.fieldStatus"),
      metadata?.stale
        ? `${t("canopy.badgeStale")}: ${formatUiExternalText(metadata.stale.reason)}`
        : undefined,
    ],
    [
      t("canopy.detailClaim"),
      metadata?.claim ? formatUiExternalText(metadata.claim.ownerId) : undefined,
    ],
    [
      t("canopy.detailHeartbeat"),
      metadata?.claim ? formatUpdatedTime(metadata.claim.lastHeartbeatAt) : undefined,
    ],
  ];
  const detailSections = getDetailSections(card);
  const hasTechnicalDetails = Boolean(
    linkedSessionKey ||
    card.runId ||
    card.execution?.runId ||
    automation?.tenant ||
    metadataFields.some(([, value]) => value !== undefined && value !== "") ||
    notifications.length ||
    attempts.length ||
    proof.length ||
    detailSections.some(([, values]) => values.some((value) => value.trim())),
  );
  if (!hasTechnicalDetails) {
    return nothing;
  }
  return html`<section
    class="canopy-detail__tabpanel canopy-detail__technical"
    id="canopy-detail-panel-details"
    role="tabpanel"
    aria-labelledby="canopy-detail-tab-details"
    tabindex="0"
    ?hidden=${!active}
  >
    <h3>${t("canopy.detailTechnical")}</h3>
    <div class="canopy-detail__technical-properties">
      ${renderDetailRow(t("canopy.fieldSession"), linkedSessionKey)}
      ${renderDetailRow(t("canopy.detailRun"), card.runId ?? card.execution?.runId)}
      ${renderDetailRow(t("canopy.detailTenant"), automation?.tenant)}
      ${metadataFields.map(([label, value]) => renderDetailRow(label, value))}
    </div>
    ${
      notifications.length
        ? html`<section class="canopy-detail__section">
            <h3>${t("canopy.detailNotifications")}</h3>
            <ol class="canopy-detail__list">
              ${notifications.map(
                (notification) => html`<li>${formatUiExternalText(notification.message)}</li>`,
              )}
            </ol>
          </section>`
        : nothing
    }
    ${renderAttemptDetails(attempts)} ${renderProofDetails(proof)}
    ${detailSections.map(([title, values]) => renderDetailList(title, values))}
  </section>`;
}
