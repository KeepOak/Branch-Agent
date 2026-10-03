import type {
  CanopyBoardSummary,
  CanopySessionsBoardRead,
} from "@branch/canopy-contract";
import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import type { ControlUiHost } from "branch/plugin-sdk/control-ui";
import { renderAgentAvatar, renderSelectPicker } from "../../components/host-components.ts";
import { icons } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { listSelectableAgents } from "../../lib/agents/display.ts";
import { formatDateTimeMs } from "../../lib/format.ts";
import { canopyBoardName } from "../../lib/canopy/board-presentation.ts";
import { agentDisplayName } from "./agent-filter.ts";
import type { SessionsBoardController } from "./sessions-board-controller.ts";
import { cardRelativeTime } from "./view-card-time.ts";
import { boardScrollEdgesRef } from "./view-scroll-fade.ts";
import { renderSessionStatusBadge } from "./view-session-status.ts";
import "../../styles/sessions-board.css";

export function renderSessionsBoard(props: {
  board: CanopyBoardSummary;
  boards: CanopyBoardSummary[];
  controller: SessionsBoardController;
  host: ControlUiHost;
  heading: TemplateResult;
  scopeControl?: TemplateResult;
  pageError?: string;
  overlayOpen: boolean;
  onNewBoard: () => void;
  onBoardChange: (boardId: string) => void;
}) {
  const { controller, host } = props;
  const snapshot = controller.snapshot;
  const columns = snapshot?.columns ?? props.board.sessions?.columns ?? [];
  const visibleSessions = (snapshot?.sessions ?? []).filter(
    (session) => !host.agents.scopeId || session.agentId === host.agents.scopeId,
  );
  const writable = host.connection.connected && host.connection.canWrite && !controller.busy;
  const visibleError = [props.pageError, controller.error].filter(Boolean).join("\n");
  const agents = listSelectableAgents(host.agents.rows);
  const peopleOptions = [
    { value: "everyone", label: t("canopy.sessionsBoard.everyone") },
    { value: "me", label: t("canopy.sessionsBoard.involvingMe") },
    ...(snapshot?.people ?? [])
      .filter((person) => person.identity.id !== controller.viewerProfileId)
      .map((person) => ({
        value: `profile:${person.identity.id}`,
        label: person.label || person.identity.id,
      })),
  ];
  if (
    controller.peopleFilter.startsWith("profile:") &&
    !peopleOptions.some((option) => option.value === controller.peopleFilter)
  ) {
    peopleOptions.push({
      value: controller.peopleFilter,
      label: controller.peopleFilter.slice(8),
    });
  }
  const renderSession = (session: CanopySessionsBoardRead["sessions"][number]) => {
    const title = session.label || session.derivedTitle || session.key;
    const agentName = agentDisplayName(
      agents.find((agent) => agent.id === session.agentId),
      session.agentId,
    );
    const run = session.run === "active" ? "running" : session.run;
    const source = t(`canopy.sessionsBoard.source.${session.source}`);
    return html`<button
      class="canopy-session-tile ${controller.draggedKey === session.key ? "canopy-session-tile--dragging" : ""}"
      type="button"
      data-session-key=${session.key}
      title=${[title, source, session.reason].filter(Boolean).join("\n")}
      draggable=${writable ? "true" : "false"}
      @click=${() => host.sessions.open({ sessionKey: session.key, agentId: session.agentId })}
      @dragstart=${(event: DragEvent) => {
        if (!writable) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData("text/plain", session.key);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
        controller.drag(session.key);
      }}
      @dragend=${() => controller.drag()}
    >
      <span class="canopy-session-tile__title">${title}</span>
      ${session.observerDigest?.headline ? html`<span class="canopy-session-tile__headline">${session.observerDigest.headline}</span>` : nothing}
      <span class="canopy-session-tile__meta">
        <span
          class="canopy-session-tile__agent"
          title=${`${agentName} (agent:${session.agentId})`}
        >
          ${renderAgentAvatar({ agentId: session.agentId, label: agentName })}${agentName}
        </span>
        ${renderSessionStatusBadge({ state: run, label: t(`canopy.sessionsBoard.run.${session.run}`), detail: "", visible: true, tone: session.run === "active" ? "live" : session.run === "failed" ? "blocked" : "idle" })}
      </span>
      ${session.pullRequests.length ? html`<span class="canopy-session-tile__prs">${session.pullRequests.map((pr) => html`<span class="canopy-session-pr" data-state=${pr.state}>${pr.state === "merged" ? icons.gitMerge : icons.gitPullRequest}#${pr.number} · ${t(`canopy.sessionsBoard.pullRequest.${pr.state}`)}</span>`)}</span>` : nothing}
      <span class="canopy-session-tile__time" title=${formatDateTimeMs(session.lastActivityAt)}
        >${cardRelativeTime(session.lastActivityAt, Date.now())}</span
      >
    </button>`;
  };
  return html`<section class="canopy canopy-sessions">
    <div
      class="canopy-main"
      ?inert=${props.overlayOpen}
      aria-hidden=${props.overlayOpen ? "true" : nothing}
    >
      <header class="canopy-heading">
        ${props.heading}
        <div class="canopy-heading__actions settings-section__actions">
          ${host.connection.canWrite ? html`<button class="btn canopy-new-board" type="button" ?disabled=${!writable} @click=${props.onNewBoard}>${icons.plus}${t("canopy.newBoard")}</button>` : nothing}
          ${controller.hasDock ? html`<button class="btn canopy-board-agent" type="button" ?disabled=${!writable || !snapshot} @click=${() => controller.openAgent()}>${icons.messageSquare}${t("canopy.sessionsBoard.agent")}</button>` : nothing}
          <button
            class="btn btn--icon btn--ghost canopy-refresh"
            type="button"
            aria-label=${t("common.refresh")}
            aria-busy=${controller.loading || controller.busy}
            ?disabled=${!host.connection.connected || controller.loading || controller.busy}
            @click=${() => (host.connection.canWrite ? controller.refresh() : controller.read())}
          >
            ${icons.refresh}
          </button>
        </div>
      </header>
      <div class="canopy-toolbar">
        ${renderSelectPicker({ value: props.board.id, options: [{ value: "__all__", label: t("canopy.allBoards") }, ...props.boards.map((board) => ({ value: board.id, label: canopyBoardName(board) }))], accessibleLabel: t("canopy.boardFilter"), onSelect: props.onBoardChange })}
        <div class="canopy-agent-filter">${props.scopeControl}</div>
        ${renderSelectPicker({ value: controller.peopleFilter, options: peopleOptions, accessibleLabel: t("canopy.sessionsBoard.peopleFilter"), searchable: true, disabled: !host.connection.connected || controller.busy || !snapshot, onSelect: (value) => controller.selectPeople(value) }, "canopy-people-filter")}
      </div>
      ${visibleError ? html`<div class="canopy-sessions__warning" role="alert">${visibleError}</div>` : nothing}
      ${snapshot?.warning ? html`<div class="canopy-sessions__warning" role="status">${snapshot.warning}</div>` : nothing}
      ${!snapshot && controller.loading ? html`<div role="status">${t("canopy.sessionsBoard.loading")}</div>` : nothing}
      <div class="canopy-board-viewport">
        <div
          ${ref(boardScrollEdgesRef())}
          class="canopy-board canopy-board--page canopy-board--comfortable"
        >
          ${columns.map((column) => {
            const sessions = visibleSessions.filter((session) => session.columnId === column.id);
            const color = host.components.resolveAppearanceColor(column.color) || "var(--muted)";
            return html`<section
              class="canopy-column ${controller.dropColumn === column.id ? "canopy-column--drop-target" : ""}"
              data-session-column=${column.id}
              style=${`--canopy-column-accent: ${color}`}
              aria-label=${`${column.label}, ${sessions.length}`}
              @dragover=${(event: DragEvent) => {
                if (!writable || !controller.draggedKey) {
                  return;
                }
                event.preventDefault();
                if (event.dataTransfer) {
                  event.dataTransfer.dropEffect = "move";
                }
                if (controller.dropColumn !== column.id) {
                  controller.drag(controller.draggedKey, column.id);
                }
              }}
              @drop=${(event: DragEvent) => {
                event.preventDefault();
                const key = controller.draggedKey;
                controller.drag();
                if (writable && key) {
                  void controller.move(key, column.id);
                }
              }}
            >
              <header class="canopy-column__header" title=${column.description}>
                <h2>
                  ${column.label}<span class="canopy-column__count">${sessions.length}</span>
                </h2>
              </header>
              <div class="canopy-column__cards">
                ${sessions.map(renderSession)}${sessions.length ? nothing : html`<span class="canopy-sessions__empty">${t("canopy.sessionsBoard.empty")}</span>`}
              </div>
            </section>`;
          })}
        </div>
      </div>
    </div>
  </section>`;
}
