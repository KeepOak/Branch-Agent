import type { CronJob } from "@branch/gateway-protocol";
import type { CanopyMetadata } from "@branch/canopy-contract";
import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { icons } from "../../components/icons.ts";
import { canopyHost } from "../../host.ts";
import { t } from "../../i18n/index.ts";
import { formatUiError } from "../../lib/format-error.ts";
import { formatDurationCompact } from "../../lib/format.ts";
import { automationNextRunTime } from "./view-card-time.ts";
import { formatUpdatedTime, type BoardAutomationState } from "./view-helpers.ts";
import { canopyPopoverRef } from "./view-popover.ts";

export async function loadBoardAutomation(
  client: GatewayBrowserClient,
  jobId: string,
): Promise<BoardAutomationState> {
  try {
    const job = await client.request<CronJob>("cron.get", { id: jobId });
    return { jobId, status: "loaded", job };
  } catch (error) {
    return { jobId, status: "unavailable", error: formatUiError(error) };
  }
}

function automationSchedule(job: CronJob): string {
  const schedule = job.schedule;
  if (schedule.kind === "cron") {
    return `${schedule.expr}${schedule.tz ? ` · ${schedule.tz}` : ""}`;
  }
  if (schedule.kind === "every") {
    return t("canopy.automationEvery", {
      duration: formatDurationCompact(schedule.everyMs) ?? String(schedule.everyMs),
    });
  }
  if (schedule.kind === "at") {
    return t("canopy.automationAt", {
      time: formatUpdatedTime(Date.parse(schedule.at)) || schedule.at,
    });
  }
  if (schedule.kind === "on-exit") {
    return t("canopy.automationOnExit", { command: schedule.command });
  }
  return t("canopy.automationStream", { command: schedule.command.join(" ") });
}

export function renderBoardAutomationHeading(automation: BoardAutomationState | undefined) {
  if (!automation) {
    return nothing;
  }
  const job = automation.status === "loaded" ? automation.job : undefined;
  const infoId = `canopy-automation-${encodeURIComponent(automation.jobId)}`;
  const ageMinutes = job ? Math.floor(Math.max(0, Date.now() - job.updatedAtMs) / 60_000) : 0;
  const updated = ageMinutes
    ? t("canopy.automationUpdatedAgo", {
        time: formatDurationCompact(ageMinutes * 60_000) ?? "",
      })
    : t("canopy.automationUpdatedNow");
  return html`
    <div
      class="canopy-heading__automation"
      role="group"
      aria-label=${t("canopy.boardAutomation")}
      aria-busy=${automation.status === "loading"}
    >
      ${
        job
          ? html`
              <a
                class="canopy-heading__automation-name"
                href=${`${canopyHost().basePath}/automations?job=${encodeURIComponent(automation.jobId)}`}
                aria-describedby=${infoId}
                aria-label=${t("canopy.openNamedAutomation", {
                  name: job.displayName ?? job.name,
                })}
              >
                <span class="canopy-heading__automation-icon" aria-hidden="true"
                  >${icons.calendarClock}</span
                >
                <span class="canopy-heading__automation-label"
                  >${job.displayName ?? job.name}</span
                >
              </a>
              <div
                id=${infoId}
                class="canopy-automation-info"
                popover="auto"
                role="tooltip"
                ${ref(canopyPopoverRef("start", true))}
              >
                <strong>${t("canopy.boardAutomation")}</strong>
                ${job.description ? html`<p>${job.description}</p>` : nothing}
                <dl>
                  <dt>${t("canopy.automationState")}</dt>
                  <dd>
                    ${t(job.enabled ? "canopy.automationEnabled" : "canopy.automationPaused")}
                  </dd>
                  <dt>${t("canopy.automationFrequency")}</dt>
                  <dd>${automationSchedule(job)}</dd>
                  <dt>${t("canopy.automationNextRunLabel")}</dt>
                  <dd>
                    ${
                      job.enabled && job.state.nextRunAtMs
                        ? formatUpdatedTime(job.state.nextRunAtMs)
                        : t("canopy.automationNotScheduled")
                    }
                  </dd>
                  <dt>${t("canopy.detailUpdated")}</dt>
                  <dd>${formatUpdatedTime(job.updatedAtMs)}</dd>
                </dl>
              </div>
            `
          : html`
              <span
                class="canopy-heading__automation-name"
                title=${
                  automation.status === "unavailable"
                    ? t("canopy.automationRefreshHint")
                    : nothing
                }
              >
                <span class="canopy-heading__automation-icon" aria-hidden="true"
                  >${icons.calendarClock}</span
                >
                <span class="canopy-heading__automation-label"
                  >${t(
                    automation.status === "loading"
                      ? "canopy.automationLoading"
                      : "canopy.automationUnavailable",
                  )}</span
                >
              </span>
            `
      }
      ${
        job
          ? html`
              <span class="canopy-heading__automation-meta">
                <span>${job.enabled ? updated : t("canopy.automationPaused")}</span>
                ${
                  job.enabled && job.state.nextRunAtMs
                    ? html`<span class="canopy-heading__automation-next-run">
                        <time
                          datetime=${new Date(job.state.nextRunAtMs).toISOString()}
                          title=${formatUpdatedTime(job.state.nextRunAtMs)}
                          >${automationNextRunTime(job.state.nextRunAtMs, Date.now())}</time
                        >
                      </span>`
                    : nothing
                }
              </span>
            `
          : nothing
      }
    </div>
  `;
}

export function renderBoardAutomation(
  automation: BoardAutomationState | undefined,
  onNavigate?: (event: MouseEvent) => void,
) {
  return automation
    ? html`
        <section class="canopy-board-draft__automation">
          <span class="canopy-board-draft__automation-label"
            >${t("canopy.boardAutomation")}</span
          >
          <div class="canopy-board-draft__automation-row">
            <span class="canopy-board-draft__automation-icon" aria-hidden="true"
              >${icons.calendarClock}</span
            >
            <div class="canopy-board-draft__automation-copy">
              ${
                automation.status === "loaded"
                  ? html`
                      <strong>${automation.job.displayName ?? automation.job.name}</strong>
                      <span>${automationSchedule(automation.job)}</span>
                      ${
                        !automation.job.enabled
                          ? html`<small>${t("canopy.automationPaused")}</small>`
                          : automation.job.state.nextRunAtMs
                            ? html`<small
                                >${t("canopy.automationNextRun", {
                                  time: formatUpdatedTime(automation.job.state.nextRunAtMs),
                                })}</small
                              >`
                            : nothing
                      }
                    `
                  : html`
                      <strong
                        >${t(
                          automation.status === "loading"
                            ? "canopy.automationLoading"
                            : "canopy.automationUnavailable",
                        )}</strong
                      >
                      <span>${automation.jobId}</span>
                      ${
                        automation.status === "unavailable"
                          ? html`<small>${automation.error}</small>`
                          : nothing
                      }
                    `
              }
            </div>
            ${
              automation.status === "loaded"
                ? html`
                    <a
                      @click=${onNavigate ?? nothing}
                      href=${`${canopyHost().basePath}/automations?job=${encodeURIComponent(automation.jobId)}`}
                      aria-label=${t("canopy.openNamedAutomation", {
                        name: automation.job.displayName ?? automation.job.name,
                      })}
                    >
                      <span>${t("canopy.openBoardAutomation")}</span>
                    </a>
                  `
                : nothing
            }
          </div>
        </section>
      `
    : nothing;
}

export function automationDetailFields(automation: CanopyMetadata["automation"]) {
  const fields: Array<readonly [string, string | number | undefined]> = automation
    ? [
        [t("canopy.detailScheduled"), formatUpdatedTime(automation.scheduledAt)],
        [t("canopy.detailSkills"), automation.skills?.join(", ")],
        [
          t("canopy.detailWorkspace"),
          [automation.workspace?.kind, automation.workspace?.path, automation.workspace?.branch]
            .filter(Boolean)
            .join(" · "),
        ],
        [t("canopy.detailDispatchCount"), automation.dispatchCount],
        [t("canopy.detailLastDispatch"), formatUpdatedTime(automation.lastDispatchAt)],
        [
          t("canopy.detailRuntimeLimit"),
          automation.maxRuntimeSeconds !== undefined
            ? (formatDurationCompact(automation.maxRuntimeSeconds * 1000) ?? undefined)
            : undefined,
        ],
        [t("canopy.detailRetryLimit"), automation.maxRetries],
      ]
    : [];
  return fields.filter(([, value]) => value !== undefined && value !== "");
}
