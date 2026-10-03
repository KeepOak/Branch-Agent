import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { renderAgentAvatar } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { formatUiExternalText } from "../../lib/format-error.ts";
import { formatDurationCompact } from "../../lib/format.ts";
import { selectCardAlert, type CardAlert } from "../../lib/canopy/card-alerts.ts";
import type { CanopyCard, CanopyLifecycle } from "../../lib/canopy/index.ts";
import { cardAgentLabel } from "./agent-filter.ts";
import { cardRelativeTime } from "./view-card-time.ts";
import {
  formatPriorityLabel,
  formatUpdatedTime,
  renderLifecycleIcon,
  renderPriorityIcon,
  type CanopyProps,
} from "./view-helpers.ts";
import { renderSessionStatus, type SessionStatusPresentation } from "./view-session-status.ts";

function alertLabel(alert: CardAlert) {
  if (alert.kind === "stale") {
    if (alert.ageMs === undefined) {
      return t("canopy.sessionStatus.stale");
    }
    const minutes = Math.max(1, Math.floor((alert.ageMs ?? 0) / 60_000));
    return t("canopy.cardStaleAge", { age: formatDurationCompact(minutes * 60_000) ?? "" });
  }
  if (alert.kind === "dependency") {
    return t("canopy.dependenciesBlocked", { count: String(alert.count) });
  }
  return formatUiExternalText(alert.title);
}

export function renderCardAlert(alerts: CardAlert[], descriptionId: string) {
  const alert = selectCardAlert(alerts);
  if (!alert) {
    return nothing;
  }
  const fullText = alerts
    .map((entry) =>
      [
        ...new Set(
          [
            alertLabel(entry),
            formatUiExternalText(entry.title),
            formatUiExternalText(entry.detail),
          ].filter(Boolean),
        ),
      ].join(" — "),
    )
    .join("\n");
  return html`<div
      class="canopy-card__alert canopy-card__alert--${alert.severity}"
      title=${fullText}
    >
      <span class="canopy-truncate">${alertLabel(alert)}</span>
      <span class="canopy-card__alert-marker" aria-hidden="true"
        >${alert.severity === "info" ? icons.info : icons.alertTriangle}</span
      >
    </div>
    <span id=${descriptionId} hidden>${fullText}</span>`;
}

export function renderCardUpdatedTime(updatedAt: number | undefined, now: number) {
  return updatedAt === undefined
    ? nothing
    : html`<time
        class="canopy-card__updated"
        datetime=${new Date(updatedAt).toISOString()}
        title=${t("canopy.detailUpdatedValue", { time: formatUpdatedTime(updatedAt) })}
        >${cardRelativeTime(updatedAt, now)}</time
      >`;
}

export function renderCardPriority(card: CanopyCard) {
  return card.priority === "normal"
    ? nothing
    : html`<span class="canopy-card__priority">
        <span aria-hidden="true">${renderPriorityIcon(card.priority)}</span>${formatPriorityLabel(
          card.priority,
        )}
      </span>`;
}

const pendingLabelMeasurements = new Map<HTMLElement, () => (() => () => void) | undefined>();
let labelMeasurementFrame: number | undefined;

function flushLabelMeasurements() {
  labelMeasurementFrame = undefined;
  // Prepare all chips, then read every card before hiding chips on any card.
  const measurements = [...pendingLabelMeasurements.values()].flatMap((prepare) => {
    const measure = prepare();
    return measure ? [measure] : [];
  });
  const updates = measurements.map((measure) => measure());
  pendingLabelMeasurements.clear();
  for (const update of updates) {
    update();
  }
}

function labelOverflowRef(labels: readonly string[]) {
  let dispose = () => {};
  return (element: Element | undefined) => {
    dispose();
    if (!(element instanceof HTMLElement)) {
      return;
    }
    let measuredWidth = -1;
    const update = () => {
      pendingLabelMeasurements.set(element, () => {
        const chips = [...element.querySelectorAll<HTMLElement>(".canopy-card__label")];
        const overflow = element.querySelector<HTMLElement>(".canopy-card__label-overflow");
        if (!overflow) {
          return undefined;
        }
        for (const chip of chips) {
          chip.hidden = false;
        }
        overflow.hidden = false;
        overflow.textContent = `+${labels.length}`;
        return () => {
          const available = element.clientWidth;
          measuredWidth = available;
          const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
          const widths = chips.map((chip) => chip.getBoundingClientRect().width);
          const total =
            widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, chips.length - 1);
          let visible = chips.length;
          if (total > available) {
            let used = overflow.getBoundingClientRect().width;
            visible = 0;
            for (const width of widths) {
              if (used + gap + width > available) {
                break;
              }
              used += gap + width;
              visible++;
            }
          }
          return () => {
            chips.forEach((chip, index) => {
              chip.hidden = index >= visible;
            });
            overflow.hidden = visible === chips.length;
            overflow.textContent = `+${chips.length - visible}`;
            overflow.title = labels.slice(visible).join(", ");
            overflow.setAttribute(
              "aria-label",
              t("canopy.cardMoreLabels", {
                count: String(chips.length - visible),
                labels: labels.slice(visible).join(", "),
              }),
            );
          };
        };
      });
      labelMeasurementFrame ??= requestAnimationFrame(flushLabelMeasurements);
    };
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            if (entries.some((entry) => entry.contentRect.width !== measuredWidth)) {
              update();
            }
          })
        : null;
    update();
    observer?.observe(element);
    dispose = () => {
      pendingLabelMeasurements.delete(element);
      if (pendingLabelMeasurements.size === 0 && labelMeasurementFrame !== undefined) {
        cancelAnimationFrame(labelMeasurementFrame);
        labelMeasurementFrame = undefined;
      }
      observer?.disconnect();
    };
  };
}

export function renderCardMeta(card: CanopyCard, archived: boolean) {
  if (!card.labels.length && !archived) {
    return nothing;
  }
  return html`<div class="canopy-card__meta">
    ${
      card.labels.length
        ? html`<div class="canopy-card__labels" ${ref(labelOverflowRef(card.labels))}>
            ${card.labels.map(
              (label) =>
                html`<span
                  class="canopy-chip canopy-truncate canopy-card__label"
                  title=${label}
                  >${label}</span
                >`,
            )}
            <span class="canopy-chip canopy-card__label-overflow" hidden></span>
          </div>`
        : nothing
    }
    ${
      archived
        ? html`<span class="canopy-card__archived">${t("canopy.archived")}</span>`
        : nothing
    }
  </div>`;
}

export function renderCardCounts(card: CanopyCard) {
  const metadata = card.metadata;
  const attempts = metadata?.attempts?.length ?? 0;
  const counts: { count: number; label: string; icon: TemplateResult }[] = [
    {
      count: metadata?.comments?.length ?? 0,
      label: "canopy.badgeComments",
      icon: icons.messageSquare,
    },
    { count: metadata?.proof?.length ?? 0, label: "canopy.badgeProof", icon: icons.fileText },
    {
      count: (metadata?.artifacts?.length ?? 0) + (metadata?.attachments?.length ?? 0),
      label: "canopy.cardFiles",
      icon: icons.paperclip,
    },
    {
      count: metadata?.diagnostics?.length ?? 0,
      label: "canopy.cardWarnings",
      icon: icons.info,
    },
    { count: attempts, label: "canopy.badgeAttempts", icon: icons.refresh },
    {
      count: metadata?.failureCount ?? 0,
      label: "canopy.badgeFailures",
      icon: icons.alertTriangle,
    },
  ].filter((entry) => entry.count > 0);
  return counts.length
    ? html`<div class="canopy-card__counts">
        ${counts.map(
          (entry) => html`<span
            title=${t(entry.label, { count: String(entry.count) })}
            aria-label=${t(entry.label, { count: String(entry.count) })}
          >
            <i aria-hidden="true">${entry.icon}</i>${entry.count}
          </span>`,
        )}
      </div>`
    : nothing;
}

function renderAgentChip(props: CanopyProps, card: CanopyCard) {
  const label = cardAgentLabel(card, props.agentsList);
  return html`<span
    class="canopy-agent-chip canopy-agent-avatar"
    title=${label}
    role="img"
    aria-label=${label}
  >
    ${renderAgentAvatar({
      agentId: card.agentId?.trim() || props.agentsList?.defaultId || props.defaultAgentId || "",
      label,
    })}
  </span>`;
}

export function renderCardSession(
  props: CanopyProps,
  card: CanopyCard,
  lifecycle: CanopyLifecycle,
  status: SessionStatusPresentation,
) {
  const hasSession = lifecycle.state !== "unlinked";
  const sessionName = hasSession
    ? (lifecycle.session?.displayName ?? lifecycle.session?.label ?? t("canopy.fieldSession"))
    : cardAgentLabel(card, props.agentsList);
  return html`<div class="canopy-card__session canopy-card__session--${status.tone}">
    ${renderAgentChip(props, card)}
    <span class="canopy-card__session-name canopy-truncate" title=${sessionName}
      >${sessionName}</span
    >
    <span class="canopy-card__session-state">
      ${
        hasSession && !status.visible
          ? html`<span
              class="canopy-card__session-marker"
              role="img"
              aria-label=${status.label}
              title=${status.detail}
            >
              ${renderLifecycleIcon(lifecycle)}
            </span>`
          : nothing
      }
      ${renderSessionStatus(status, { id: `canopy-card-status-${card.id}`, sessionName })}
    </span>
  </div>`;
}
