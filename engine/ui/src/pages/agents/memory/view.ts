import { expectDefined } from "@branch/normalization-core";
import { parseDateStringTimestampMs } from "@branch/normalization-core/number-coercion";
import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { renderHubTabs } from "../../../components/hub-tabs.ts";
import { trellisPetSeed } from "../../../components/trellis-pet-contract.ts";
import { createTrellisPetLook, renderTrellisSvg } from "../../../components/trellis-pet-look.ts";
import { toSanitizedMarkdownHtml } from "../../../components/markdown.ts";
import "../../../components/modal-dialog.ts";
import { i18n, t } from "../../../i18n/index.ts";
import { registerRingsEnglish } from "../../../i18n/locales/en-rings.ts";
import { registerSettingsEnglish } from "../../../i18n/locales/en-settings.ts";
import { formatUiError } from "../../../lib/format-error.ts";
import "../../../styles/dreams.css";
import type {
  RingsEntry,
  WikiImportInsights,
  WikiOverview,
  WikiPagePreview,
} from "./rings.ts";

registerSettingsEnglish();
registerRingsEnglish();

type DiaryEntry = {
  date: string;
  body: string;
};

type DiaryPanel =
  | ReturnType<typeof html>
  | { navigation: ReturnType<typeof html>; content: ReturnType<typeof html> };

const DIARY_START_RE = /<!--\s*branch:rings:diary:start\s*-->/;
const DIARY_END_RE = /<!--\s*branch:rings:diary:end\s*-->/;

function parseDiaryEntries(raw: string): DiaryEntry[] {
  let content = raw;
  const startMatch = DIARY_START_RE.exec(raw);
  const endMatch = DIARY_END_RE.exec(raw);
  if (startMatch && endMatch && endMatch.index > startMatch.index) {
    content = raw.slice(startMatch.index + startMatch[0].length, endMatch.index);
  }

  const entries: DiaryEntry[] = [];
  const blocks = content.split(/\n---\n/).filter((b) => b.trim().length > 0);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    let date = "";
    const bodyLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Date lines are wrapped in *asterisks* like: *April 5, 2026, 3:00 AM*
      if (!date && trimmed.startsWith("*") && trimmed.endsWith("*") && trimmed.length > 2) {
        date = trimmed.slice(1, -1);
        continue;
      }
      if (trimmed.startsWith("#") || trimmed.startsWith("<!--")) {
        continue;
      }
      if (trimmed.length > 0) {
        bodyLines.push(trimmed);
      }
    }

    if (bodyLines.length > 0) {
      entries.push({ date, body: bodyLines.join("\n") });
    }
  }

  return entries;
}

function formatDiaryChipLabel(date: string): string {
  const parsed = parseDateStringTimestampMs(date);
  if (parsed === undefined) {
    return date;
  }
  const value = new Date(parsed);
  return `${value.getMonth() + 1}/${value.getDate()}`;
}

type RingsPhaseInfo = {
  enabled: boolean;
  cron: string;
  nextRunAtMs?: number;
};

type RingsProps = {
  access: {
    canOpenConfig: boolean;
    canBackfillDiary: boolean;
    canDedupeDreamDiary: boolean;
    canResetDiary: boolean;
    canResetGroundedShortTerm: boolean;
    canRepairRingsArtifacts: boolean;
  };
  viewState: RingsViewState;
  active: boolean;
  selectedAgentId: string;
  shortTermCount: number;
  promotedCount: number;
  phases?: {
    light: RingsPhaseInfo;
    deep: RingsPhaseInfo;
    rem: RingsPhaseInfo;
  };
  shortTermEntries: RingsEntry[];
  promotedEntries: RingsEntry[];
  ringsOf: string | null;
  nextCycle: string | null;
  timezone: string | null;
  statusError: string | null;
  modeSaving: boolean;
  dreamDiaryLoading: boolean;
  dreamDiaryActionLoading: boolean;
  dreamDiaryActionMessage: { kind: "success" | "error"; text: string } | null;
  dreamDiaryActionArchivePath: string | null;
  dreamDiaryError: string | null;
  dreamDiaryContent: string | null;
  memoryWikiEnabled: boolean;
  wikiImportInsightsLoading: boolean;
  wikiImportInsightsError: string | null;
  wikiImportInsights: WikiImportInsights | null;
  wikiOverviewLoading: boolean;
  wikiOverviewError: string | null;
  wikiOverview: WikiOverview | null;
  onRefreshDiary: () => void;
  onRefreshImports: () => void;
  onRefreshWikiOverview: () => void;
  onOpenConfig: () => void;
  onOpenWikiPage: (lookup: string) => Promise<WikiPagePreview | null>;
  onBackfillDiary: () => void;
  onCopyRingsArchivePath: () => void;
  onDedupeDreamDiary: () => void;
  onResetDiary: () => void;
  onResetGroundedShortTerm: () => void;
  onRepairRingsArtifacts: () => void;
  onViewStateChange: () => void;
};

const DREAM_PHRASE_KEYS = [
  "rings.phrases.consolidatingMemories",
  "rings.phrases.tidyingKnowledgeGraph",
  "rings.phrases.replayingConversations",
  "rings.phrases.weavingShortTerm",
  "rings.phrases.defragmentingMemoryLane",
  "rings.phrases.filingLooseThoughts",
  "rings.phrases.connectingDots",
  "rings.phrases.compostingContext",
  "rings.phrases.alphabetizingSubconscious",
  "rings.phrases.promotingHunches",
  "rings.phrases.forgettingNoise",
  "rings.phrases.ringsEmbeddings",
  "rings.phrases.reorganizingAttic",
  "rings.phrases.indexingDay",
  "rings.phrases.nurturingInsights",
  "rings.phrases.simmeringIdeas",
  "rings.phrases.whisperingVectorStore",
] as const;

const DREAM_PHASE_LABEL_KEYS = {
  light: "rings.phase.light",
  deep: "rings.phase.deep",
  rem: "rings.phase.rem",
} as const;

const DREAM_SWAP_MS = 6_000;

export type RingsViewState = {
  dreamIndex: number;
  dreamLastSwap: number;
  activeSubTab: "scene" | "diary" | "advanced";
  activeDiarySubTab: "dreams" | "insights" | "wiki";
  advancedWaitingSort: "recent" | "signals";
  expandedInsightCards: Set<string>;
  expandedWikiCards: Set<string>;
  diaryPage: number;
  wikiPreviewRequestId: number;
  wikiPreviewOpen: boolean;
  wikiPreviewLoading: boolean;
  wikiPreviewTitle: string;
  wikiPreviewPath: string;
  wikiPreviewUpdatedAt: string | null;
  wikiPreviewContent: string;
  wikiPreviewTotalLines: number | null;
  wikiPreviewTruncated: boolean;
  wikiPreviewError: string | null;
};

export function createRingsViewState(): RingsViewState {
  return {
    dreamIndex: Math.floor(Math.random() * DREAM_PHRASE_KEYS.length),
    dreamLastSwap: 0,
    activeSubTab: "scene",
    activeDiarySubTab: "dreams",
    advancedWaitingSort: "recent",
    expandedInsightCards: new Set(),
    expandedWikiCards: new Set(),
    diaryPage: 0,
    wikiPreviewRequestId: 0,
    wikiPreviewOpen: false,
    wikiPreviewLoading: false,
    wikiPreviewTitle: "",
    wikiPreviewPath: "",
    wikiPreviewUpdatedAt: null,
    wikiPreviewContent: "",
    wikiPreviewTotalLines: null,
    wikiPreviewTruncated: false,
    wikiPreviewError: null,
  };
}

function setDiaryPage(state: RingsViewState, page: number, entryCount: number): void {
  state.diaryPage = Math.max(0, Math.min(page, Math.max(0, entryCount - 1)));
}

function currentDreamPhrase(state: RingsViewState): string {
  const now = Date.now();
  if (now - state.dreamLastSwap > DREAM_SWAP_MS) {
    state.dreamLastSwap = now;
    state.dreamIndex = (state.dreamIndex + 1) % DREAM_PHRASE_KEYS.length;
  }
  return t(DREAM_PHRASE_KEYS[state.dreamIndex] ?? DREAM_PHRASE_KEYS[0]);
}

const STARS: {
  top: number;
  left: number;
  size: number;
  delay: number;
  hue: "neutral" | "accent";
}[] = [
  { top: 8, left: 15, size: 3, delay: 0, hue: "neutral" },
  { top: 12, left: 72, size: 2, delay: 1.4, hue: "neutral" },
  { top: 22, left: 35, size: 3, delay: 0.6, hue: "accent" },
  { top: 18, left: 88, size: 2, delay: 2.1, hue: "neutral" },
  { top: 35, left: 8, size: 2, delay: 0.9, hue: "neutral" },
  { top: 45, left: 92, size: 2, delay: 1.7, hue: "neutral" },
  { top: 55, left: 25, size: 3, delay: 2.5, hue: "accent" },
  { top: 65, left: 78, size: 2, delay: 0.3, hue: "neutral" },
  { top: 75, left: 45, size: 2, delay: 1.1, hue: "neutral" },
  { top: 82, left: 60, size: 3, delay: 1.8, hue: "accent" },
  { top: 30, left: 55, size: 2, delay: 0.4, hue: "neutral" },
  { top: 88, left: 18, size: 2, delay: 2.3, hue: "neutral" },
];

// The dreams sleeper is the same seeded trellis that visits the sidebar for
// this agent (eyes closed), so the pet identity carries across surfaces.
function renderDreamsCameo(agentId: string) {
  const look = createTrellisPetLook(trellisPetSeed(agentId));
  const style = `--lob-shell:${look.palette.shell};--lob-grove:${look.palette.grove}`;
  return html`
    <div class="dreams__trellis" style=${style}>${renderTrellisSvg(look, { sleeping: true })}</div>
  `;
}

export function renderRings(props: RingsProps) {
  const state = props.viewState;
  const idle = !props.active;
  const dreamText = props.ringsOf ?? currentDreamPhrase(state);

  return html`
    <div class="dreams-page">
      <div class="dreams__topbar">
        ${renderHubTabs({
          id: "dreams",
          active: state.activeSubTab,
          tabs: [
            { value: "scene", label: t("rings.tabs.scene") },
            { value: "diary", label: t("rings.tabs.diary") },
            { value: "advanced", label: t("rings.tabs.advanced") },
          ],
          ariaLabel: t("memoryPage.tabs.dreams"),
          panelId: "dreams-panel",
          variant: "sub",
          onSelect: (tab) => {
            state.activeSubTab = tab;
            props.onViewStateChange();
          },
        })}
      </div>

      <div
        id="dreams-panel"
        class="dreams__panel"
        role="tabpanel"
        aria-labelledby=${`dreams-tab-${state.activeSubTab}`}
      >
        ${
          state.activeSubTab === "scene"
            ? renderScene(props, idle, dreamText)
            : state.activeSubTab === "diary"
              ? renderDiarySection(props)
              : renderAdvancedSection(props)
        }
      </div>
    </div>
  `;
}

// Strip source citations like [memory/2026-04-09.md:9] and section headings,
// flatten structured diary entries into plain paragraphs.
function flattenDiaryBody(body: string): string[] {
  return (
    body
      .split("\n")
      .map((line) => line.trim())
      // Remove section headings that leak implementation
      .filter(
        (line) =>
          line.length > 0 &&
          line !== "What Happened" &&
          line !== "Reflections" &&
          line !== "Candidates" &&
          line !== "Possible Lasting Updates",
      )
      // Strip source citations [memory/...]
      .map((line) => line.replace(/\s*\[memory\/[^\]]+\]/g, ""))
      // Strip leading list markers and labels
      .map((line) =>
        line
          .replace(/^(?:\d+\.\s+|-\s+(?:\[[^\]]+\]\s+)?(?:[a-z_]+:\s+)?)/i, "")
          .replace(/^(?:likely_durable|likely_situational|unclear):\s+/i, "")
          .trim(),
      )
      .filter((line) => line.length > 0)
  );
}

function formatPhaseNextRun(nextRunAtMs?: number): string {
  if (!nextRunAtMs) {
    return "—";
  }
  const d = new Date(nextRunAtMs);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderScene(props: RingsProps, idle: boolean, dreamText: string) {
  return html`
    <section class="dreams ${idle ? "dreams--idle" : ""}">
      ${STARS.map(
        (s) => html`
          <div
            class="dreams__star"
            style="
              top: ${s.top}%;
              left: ${s.left}%;
              width: ${s.size}px;
              height: ${s.size}px;
              background: ${s.hue === "accent" ? "var(--accent-muted)" : "var(--text)"};
              animation-delay: ${s.delay}s;
            "
          ></div>
        `,
      )}

      <div class="dreams__moon"></div>

      ${
        props.active
          ? html`
              <div class="dreams__bubble">
                <span class="dreams__bubble-text">${dreamText}</span>
              </div>
              <div
                class="dreams__bubble-dot"
                style="top: calc(50% - 160px); left: calc(50% - 120px); width: 12px; height: 12px; animation-delay: 0.2s;"
              ></div>
              <div
                class="dreams__bubble-dot"
                style="top: calc(50% - 120px); left: calc(50% - 90px); width: 8px; height: 8px; animation-delay: 0.4s;"
              ></div>
            `
          : nothing
      }

      <div class="dreams__glow"></div>
      ${renderDreamsCameo(props.selectedAgentId)}
      <span class="dreams__z">z</span>
      <span class="dreams__z">z</span>
      <span class="dreams__z">Z</span>

      <div class="dreams__status">
        <span class="dreams__status-label"
          >${props.active ? t("rings.status.active") : t("rings.status.idle")}</span
        >
        <div class="dreams__status-detail">
          <div class="dreams__status-dot"></div>
          <span>
            ${props.promotedCount} ${t("rings.status.promotedSuffix")}
            ${
              props.nextCycle
                ? html`· ${t("rings.status.nextSweepPrefix")} ${props.nextCycle}`
                : nothing
            }
            ${props.timezone ? html`· ${props.timezone}` : nothing}
          </span>
        </div>
      </div>

      <div class="dreams__phases">
        ${(Object.keys(DREAM_PHASE_LABEL_KEYS) as (keyof typeof DREAM_PHASE_LABEL_KEYS)[]).map(
          (phaseId) => {
            const phase = props.phases?.[phaseId];
            const hasPhaseStatus = phase !== undefined;
            const enabled = phase?.enabled === true;
            const nextRun = formatPhaseNextRun(phase?.nextRunAtMs);
            const label = t(DREAM_PHASE_LABEL_KEYS[phaseId]);
            const status = !hasPhaseStatus ? "—" : enabled ? nextRun : t("rings.phase.off");
            return html`
              <div class="dreams__phase ${hasPhaseStatus && !enabled ? "dreams__phase--off" : ""}">
                <div class="dreams__phase-dot ${enabled ? "dreams__phase-dot--on" : ""}"></div>
                <span class="dreams__phase-name">${label}</span>
                <span class="dreams__phase-next">${status}</span>
              </div>
            `;
          },
        )}
      </div>

      ${
        props.statusError
          ? html`<div class="dreams__controls-error">${props.statusError}</div>`
          : nothing
      }
    </section>
  `;
}

function formatRange(path: string, startLine: number, endLine: number): string {
  return startLine === endLine ? `${path}:${startLine}` : `${path}:${startLine}-${endLine}`;
}

function formatCompactDateTime(value: string): string {
  const parsed = parseDateStringTimestampMs(value);
  if (parsed === undefined) {
    return value;
  }
  return new Date(parsed).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function basename(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").findLast(Boolean) ?? value;
}

function formatWikiCount(
  kind: "page" | "claimRow" | "openQuestion" | "contradiction",
  count: number,
): string {
  return t(`rings.wiki.counts.${kind}${count === 1 ? "One" : "s"}`, { count: String(count) });
}

const WIKI_OVERVIEW_PAGE_GROUPS = [
  ["source", "sources"],
  ["synthesis", "syntheses"],
  ["report", "reports"],
  ["entity", "entities"],
  ["concept", "concepts"],
] as const;

function formatWikiOverviewPageBreakdown(pageCounts: WikiOverview["pageCounts"]): string {
  const parts = WIKI_OVERVIEW_PAGE_GROUPS.map(([kind, group]) => {
    const count = pageCounts[kind];
    return count > 0
      ? t("rings.wiki.pageGroupSummary", {
          label: t(`rings.wiki.pageGroups.${group}`),
          count: formatWikiCount("page", count),
        })
      : null;
  }).filter((entry): entry is string => entry !== null);
  return parts.length > 0 ? parts.join("; ") : t("rings.wiki.noPagesYet");
}

function formatWikiOverviewClusterSummary(cluster: WikiOverview["clusters"][number]): string {
  const parts = [
    t("rings.wiki.sectionPageSummary", {
      label: cluster.label,
      count: formatWikiCount("page", cluster.itemCount),
    }),
  ];
  if (cluster.claimCount > 0) {
    parts.push(formatWikiCount("claimRow", cluster.claimCount));
  }
  if (cluster.questionCount > 0) {
    const questionPageCount = cluster.items.filter((item) => item.questionCount > 0).length;
    const questionCount = formatWikiCount("openQuestion", cluster.questionCount);
    parts.push(
      questionPageCount > 0
        ? t("rings.wiki.questionCountOnPages", {
            questionCount,
            pageCount: formatWikiCount("page", questionPageCount),
          })
        : questionCount,
    );
  }
  if (cluster.contradictionCount > 0) {
    parts.push(formatWikiCount("contradiction", cluster.contradictionCount));
  }
  return parts.join(" · ");
}

function formatImportBadge(item: {
  digestStatus: "available" | "withheld";
  riskLevel: "low" | "medium" | "high" | "unknown";
}): string {
  return t(
    item.digestStatus === "withheld"
      ? "rings.wiki.risk.needsReview"
      : `rings.wiki.risk.${item.riskLevel}`,
  );
}

function toggleExpandedCard(bucket: Set<string>, key: string, onChange: () => void): void {
  if (bucket.has(key)) {
    bucket.delete(key);
  } else {
    bucket.add(key);
  }
  onChange();
}

async function openWikiPreview(lookup: string, props: RingsProps): Promise<void> {
  const state = props.viewState;
  resetWikiPreview(state);
  const requestId = state.wikiPreviewRequestId;
  state.wikiPreviewOpen = true;
  state.wikiPreviewLoading = true;
  state.wikiPreviewTitle = basename(lookup);
  state.wikiPreviewPath = lookup;
  props.onViewStateChange();
  try {
    const preview = await props.onOpenWikiPage(lookup);
    if (state.wikiPreviewRequestId !== requestId || !state.wikiPreviewOpen) {
      return;
    }
    if (!preview) {
      state.wikiPreviewError = t("rings.wiki.pageNotFound", { lookup });
      return;
    }
    state.wikiPreviewTitle = preview.title;
    state.wikiPreviewPath = preview.path;
    state.wikiPreviewUpdatedAt = preview.updatedAt ?? null;
    state.wikiPreviewContent = preview.content;
    state.wikiPreviewTotalLines =
      typeof preview.totalLines === "number" ? preview.totalLines : null;
    state.wikiPreviewTruncated = preview.truncated === true;
  } catch (error) {
    if (state.wikiPreviewRequestId === requestId && state.wikiPreviewOpen) {
      state.wikiPreviewError = formatUiError(error);
    }
  } finally {
    if (state.wikiPreviewRequestId === requestId && state.wikiPreviewOpen) {
      state.wikiPreviewLoading = false;
      props.onViewStateChange();
    }
  }
}

export function resetWikiPreview(state: RingsViewState): void {
  state.wikiPreviewRequestId += 1;
  state.wikiPreviewOpen = false;
  state.wikiPreviewLoading = false;
  state.wikiPreviewTitle = "";
  state.wikiPreviewPath = "";
  state.wikiPreviewUpdatedAt = null;
  state.wikiPreviewContent = "";
  state.wikiPreviewTotalLines = null;
  state.wikiPreviewTruncated = false;
  state.wikiPreviewError = null;
}

function closeWikiPreview(props: RingsProps): void {
  resetWikiPreview(props.viewState);
  props.onViewStateChange();
}

function renderWikiPreviewOverlay(props: RingsProps) {
  const state = props.viewState;
  if (!state.wikiPreviewOpen) {
    return nothing;
  }
  return html`
    <branch-modal-dialog
      .label=${state.wikiPreviewTitle || t("rings.wiki.previewFallbackTitle")}
      style="--branch-modal-width: 1120px"
      @modal-cancel=${() => closeWikiPreview(props)}
    >
      <div class="dreams-diary__preview-panel">
        <div class="dreams-diary__preview-header">
          <div>
            <div class="dreams-diary__preview-title">
              ${state.wikiPreviewTitle || t("rings.wiki.previewFallbackTitle")}
            </div>
            <div class="dreams-diary__preview-meta">
              ${state.wikiPreviewPath}
              ${
                state.wikiPreviewUpdatedAt
                  ? ` · ${formatCompactDateTime(state.wikiPreviewUpdatedAt)}`
                  : ""
              }
            </div>
          </div>
          <button
            type="button"
            class="btn btn--subtle btn--sm"
            @click=${() => closeWikiPreview(props)}
          >
            ${t("rings.wiki.close")}
          </button>
        </div>
        <div class="dreams-diary__preview-body">
          ${
            state.wikiPreviewLoading
              ? html`<div class="dreams-diary__empty-text">${t("rings.wiki.loadingPage")}</div>`
              : state.wikiPreviewError
                ? html`<div class="dreams-diary__error">${state.wikiPreviewError}</div>`
                : html`
                    ${
                      state.wikiPreviewTruncated
                        ? html`
                            <div class="dreams-diary__preview-hint">
                              ${
                                state.wikiPreviewTotalLines !== null
                                  ? t("rings.wiki.previewTruncatedWithTotal", {
                                      count: String(state.wikiPreviewTotalLines),
                                    })
                                  : t("rings.wiki.previewTruncated")
                              }
                            </div>
                          `
                        : nothing
                    }
                    <pre class="dreams-diary__preview-pre">${state.wikiPreviewContent}</pre>
                  `
          }
        </div>
      </div>
    </branch-modal-dialog>
  `;
}

function parseSortableTimestamp(value?: string): number {
  return parseDateStringTimestampMs(value) ?? Number.NEGATIVE_INFINITY;
}

function compareWaitingEntryByRecency(a: RingsEntry, b: RingsEntry): number {
  const aMs = parseSortableTimestamp(a.lastRecalledAt);
  const bMs = parseSortableTimestamp(b.lastRecalledAt);
  if (bMs !== aMs) {
    return bMs - aMs;
  }
  if (b.totalSignalCount !== a.totalSignalCount) {
    return b.totalSignalCount - a.totalSignalCount;
  }
  return a.path.localeCompare(b.path);
}

function compareWaitingEntryBySignals(a: RingsEntry, b: RingsEntry): number {
  if (b.totalSignalCount !== a.totalSignalCount) {
    return b.totalSignalCount - a.totalSignalCount;
  }
  if (b.phaseHitCount !== a.phaseHitCount) {
    return b.phaseHitCount - a.phaseHitCount;
  }
  return compareWaitingEntryByRecency(a, b);
}

function describeWaitingEntryOrigin(entry: RingsEntry): string {
  const hasGroundedReplay = entry.groundedCount > 0;
  const hasLiveSupport = entry.recallCount > 0 || entry.dailyCount > 0;
  if (hasGroundedReplay && hasLiveSupport) {
    return t("rings.advanced.originMixed");
  }
  if (hasGroundedReplay) {
    return t("rings.advanced.originDailyLog");
  }
  return t("rings.advanced.originLive");
}

function renderAdvancedEntryList(params: {
  titleKey: string;
  descriptionKey: string;
  emptyKey: string;
  entries: RingsEntry[];
  meta: (entry: RingsEntry) => string[];
  badge?: (entry: RingsEntry) => string | null;
  controls?: ReturnType<typeof html>;
}) {
  return html`
    <section class="dreams-advanced__section">
      <div class="dreams-advanced__section-header">
        <div class="dreams-advanced__section-copy">
          <span class="dreams-advanced__section-title">${t(params.titleKey)}</span>
          <p class="dreams-advanced__section-description">${t(params.descriptionKey)}</p>
        </div>
        <div class="dreams-advanced__section-toolbar">
          ${params.controls ?? nothing}
          <span class="dreams-advanced__section-count">${params.entries.length}</span>
        </div>
      </div>
      ${
        params.entries.length === 0
          ? html`<div class="dreams-advanced__empty">${t(params.emptyKey)}</div>`
          : html`
              <div class="dreams-advanced__list">
                ${params.entries.map((entry) => {
                  const badge = params.badge?.(entry);
                  return html`
                    <article class="dreams-advanced__item" data-entry-key=${entry.key}>
                      ${badge ? html`<span class="dreams-advanced__badge">${badge}</span>` : nothing}
                      <div class="dreams-advanced__snippet">${entry.snippet}</div>
                      <div class="dreams-advanced__source">
                        ${formatRange(entry.path, entry.startLine, entry.endLine)}
                      </div>
                      <div class="dreams-advanced__meta">
                        ${params
                          .meta(entry)
                          .filter((part) => part.length > 0)
                          .join(" · ")}
                      </div>
                    </article>
                  `;
                })}
              </div>
            `
      }
    </section>
  `;
}

function renderAdvancedSection(props: RingsProps) {
  const state = props.viewState;
  const groundedEntries = props.shortTermEntries.filter((entry) => entry.groundedCount > 0);
  const waitingEntries = props.shortTermEntries.toSorted(
    state.advancedWaitingSort === "signals"
      ? compareWaitingEntryBySignals
      : compareWaitingEntryByRecency,
  );
  const description = t("rings.advanced.description");
  const summary = [
    `${groundedEntries.length} ${t("rings.advanced.summaryFromDailyLog")}`,
    `${props.shortTermCount} ${t("rings.advanced.summaryWaiting")}`,
    `${props.promotedCount} ${t("rings.advanced.summaryPromotedToday")}`,
  ].join(" · ");

  return html`
    <section class="dreams-advanced">
      <div class="dreams-advanced__header">
        <div class="dreams-advanced__intro">
          <span class="dreams-advanced__eyebrow">${t("rings.advanced.eyebrow")}</span>
          <h2 class="dreams-advanced__title">${t("rings.advanced.title")}</h2>
          ${
            description ? html`<p class="dreams-advanced__description">${description}</p>` : nothing
          }
          <div class="dreams-advanced__summary">${summary}</div>
        </div>
        <div class="dreams-advanced__actions">
          ${[
            {
              label: t("rings.scene.dedupeDiary"),
              onClick: props.onDedupeDreamDiary,
              allowed: props.access.canDedupeDreamDiary,
            },
            {
              label: t("rings.scene.repairCache"),
              onClick: props.onRepairRingsArtifacts,
              allowed: props.access.canRepairRingsArtifacts,
            },
            {
              label: t(
                props.dreamDiaryActionLoading
                  ? "rings.scene.working"
                  : "rings.scene.backfill",
              ),
              onClick: props.onBackfillDiary,
              allowed: props.access.canBackfillDiary,
            },
            {
              label: t("rings.scene.reset"),
              onClick: props.onResetDiary,
              allowed: props.access.canResetDiary,
            },
            {
              label: t("rings.scene.clearGrounded"),
              onClick: props.onResetGroundedShortTerm,
              allowed: props.access.canResetGroundedShortTerm,
            },
          ].map(
            ({ label, onClick, allowed }) => html`
              <button
                class="btn btn--subtle btn--sm"
                ?disabled=${!allowed || props.modeSaving || props.dreamDiaryActionLoading}
                @click=${() => onClick()}
              >
                ${label}
              </button>
            `,
          )}
        </div>
      </div>
      ${
        props.dreamDiaryActionMessage
          ? html`
              <div
                class="callout ${
                  props.dreamDiaryActionMessage.kind === "success" ? "success" : "danger"
                }"
                role="status"
              >
                <div class="row wrap items-center gap-2">
                  <span>${props.dreamDiaryActionMessage.text}</span>
                  ${
                    props.dreamDiaryActionArchivePath
                      ? html`
                          <button
                            class="btn btn--subtle btn--sm"
                            ?disabled=${props.dreamDiaryActionLoading}
                            @click=${() => props.onCopyRingsArchivePath()}
                          >
                            ${t("rings.wiki.copyArchivePath")}
                          </button>
                        `
                      : nothing
                  }
                </div>
              </div>
            `
          : nothing
      }

      <div class="dreams-advanced__sections">
        ${renderAdvancedEntryList({
          titleKey: "rings.advanced.stagedTitle",
          descriptionKey: "rings.advanced.stagedDescription",
          emptyKey: "rings.advanced.emptyGrounded",
          entries: groundedEntries,
          controls: html`
            <button
              class="btn btn--subtle btn--sm"
              ?disabled=${
                !props.access.canResetGroundedShortTerm ||
                props.modeSaving ||
                props.dreamDiaryActionLoading
              }
              @click=${() => props.onResetGroundedShortTerm()}
            >
              ${t("rings.scene.clearGrounded")}
            </button>
          `,
          badge: () => t("rings.advanced.originDailyLog"),
          meta: (entry) => [
            entry.groundedCount > 0
              ? `${entry.groundedCount} ${t("rings.stats.grounded").toLowerCase()}`
              : "",
            entry.recallCount > 0 ? `${entry.recallCount} recall` : "",
            entry.dailyCount > 0 ? `${entry.dailyCount} daily` : "",
          ],
        })}
        ${renderAdvancedEntryList({
          titleKey: "rings.advanced.shortTermTitle",
          descriptionKey: "rings.advanced.shortTermDescription",
          emptyKey: "rings.advanced.emptyShortTerm",
          entries: waitingEntries,
          controls: html`
            <div class="dreams-advanced__sort">
              ${(
                [
                  ["recent", "rings.advanced.sortRecent"],
                  ["signals", "rings.advanced.sortSignals"],
                ] as const
              ).map(
                ([sort, label]) => html`
                  <button
                    class="dreams-advanced__sort-btn ${
                      state.advancedWaitingSort === sort ? "dreams-advanced__sort-btn--active" : ""
                    }"
                    @click=${() => {
                      state.advancedWaitingSort = sort;
                      props.onViewStateChange();
                    }}
                  >
                    ${t(label)}
                  </button>
                `,
              )}
            </div>
          `,
          badge: describeWaitingEntryOrigin,
          meta: (entry) => [
            `${entry.totalSignalCount} ${t("rings.stats.signals").toLowerCase()}`,
            entry.recallCount > 0 ? `${entry.recallCount} recall` : "",
            entry.dailyCount > 0 ? `${entry.dailyCount} daily` : "",
            entry.groundedCount > 0
              ? `${entry.groundedCount} ${t("rings.stats.grounded").toLowerCase()}`
              : "",
            entry.phaseHitCount > 0 ? `${entry.phaseHitCount} phase hit` : "",
          ],
        })}
        ${renderAdvancedEntryList({
          titleKey: "rings.advanced.promotedTitle",
          descriptionKey: "rings.advanced.promotedDescription",
          emptyKey: "rings.advanced.emptyPromoted",
          entries: props.promotedEntries,
          badge: describeWaitingEntryOrigin,
          meta: (entry) => [
            entry.promotedAt
              ? `${t("rings.advanced.updatedPrefix")} ${formatCompactDateTime(entry.promotedAt)}`
              : "",
            entry.groundedCount > 0
              ? `${entry.groundedCount} ${t("rings.stats.grounded").toLowerCase()}`
              : "",
            entry.totalSignalCount > 0
              ? `${entry.totalSignalCount} ${t("rings.stats.signals").toLowerCase()}`
              : "",
          ],
        })}
      </div>

      ${
        props.statusError
          ? html`<div class="dreams__controls-error">${props.statusError}</div>`
          : nothing
      }
    </section>
  `;
}

type ImportedInsightItem = WikiImportInsights["clusters"][number]["items"][number];
type WikiPageItem = WikiOverview["clusters"][number]["items"][number];
type WikiInsightCard =
  | { kind: "import"; item: ImportedInsightItem }
  | { kind: "wiki"; item: WikiPageItem };

function renderInsightList(labelKey: string, entries: string[]) {
  return entries.length > 0
    ? html`
        <div class="dreams-diary__insight-list">
          <strong>${t(labelKey)}</strong>
          ${entries.map((entry) => html`<p class="dreams-diary__insight-line">• ${entry}</p>`)}
        </div>
      `
    : nothing;
}

function renderInsightDetail(labelKey: string, value: string | undefined) {
  return value
    ? html`
        <p class="dreams-diary__insight-line">
          <strong>${t(labelKey)}</strong>
          ${value}
        </p>
      `
    : nothing;
}

function renderWikiInsightBody(card: WikiInsightCard, expanded: boolean) {
  if (card.kind === "import") {
    const item = card.item;
    return html`
      <p class="dreams-diary__insight-line">${item.summary}</p>
      ${renderInsightList("rings.wiki.candidateSignals", item.candidateSignals)}
      ${renderInsightList("rings.wiki.corrections", item.correctionSignals)}
      ${
        expanded
          ? html`
              <div class="dreams-diary__insight-list">
                <strong>${t("rings.wiki.importDetails")}</strong>
                ${renderInsightDetail("rings.wiki.startedWith", item.firstUserLine)}
                ${renderInsightDetail(
                  "rings.wiki.endedOn",
                  item.lastUserLine !== item.firstUserLine ? item.lastUserLine : undefined,
                )}
                ${renderInsightDetail(
                  "rings.wiki.messages",
                  `${t("rings.wiki.counts.userMessages", {
                    count: String(item.userMessageCount),
                  })} · ${t("rings.wiki.counts.assistantMessages", {
                    count: String(item.assistantMessageCount),
                  })}`,
                )}
                ${renderInsightDetail("rings.wiki.riskReasons", item.riskReasons.join(", "))}
                ${renderInsightDetail("rings.wiki.labels", item.labels.join(", "))}
              </div>
            `
          : nothing
      }
      ${
        item.preferenceSignals.length > 0
          ? html`
              <div class="dreams-diary__insight-signals">
                ${item.preferenceSignals.map(
                  (signal) => html`<span class="dreams-diary__insight-signal">${signal}</span>`,
                )}
              </div>
            `
          : nothing
      }
    `;
  }

  const item = card.item;
  return html`
    ${item.snippet ? html`<p class="dreams-diary__insight-line">${item.snippet}</p>` : nothing}
    ${renderInsightList("rings.wiki.claims", item.claims)}
    ${renderInsightList("rings.wiki.openQuestions", item.questions)}
    ${renderInsightList("rings.wiki.contradictions", item.contradictions)}
    ${
      expanded
        ? html`
            <div class="dreams-diary__insight-list">
              <strong>${t("rings.wiki.pageDetails")}</strong>
              ${renderInsightDetail("rings.wiki.wikiPage", item.pagePath)}
              ${renderInsightDetail("rings.wiki.id", item.id)}
            </div>
          `
        : nothing
    }
  `;
}

function renderWikiInsightCard(props: RingsProps, card: WikiInsightCard) {
  const state = props.viewState;
  const item = card.item;
  const expandedCards =
    card.kind === "import" ? state.expandedInsightCards : state.expandedWikiCards;
  const expanded = expandedCards.has(item.pagePath);
  const badgeClass = card.kind === "import" ? card.item.riskLevel : "wiki";
  const badgeLabel =
    card.kind === "import"
      ? formatImportBadge(card.item)
      : t(`rings.wiki.pageTypes.${card.item.kind}`);
  const metadata =
    card.kind === "import"
      ? card.item.activeBranchMessages > 0
        ? ` · ${t("rings.wiki.counts.messages", {
            count: String(card.item.activeBranchMessages),
          })}`
        : ""
      : ` · ${item.pagePath}`;

  return html`
    <article
      class="dreams-diary__insight-card dreams-diary__insight-card--clickable"
      data-import-page=${card.kind === "import" ? item.pagePath : nothing}
      data-wiki-page=${card.kind === "wiki" ? item.pagePath : nothing}
      @click=${() => {
        if (card.kind === "wiki" && card.item.kind === "report") {
          void openWikiPreview(item.pagePath, props);
          return;
        }
        toggleExpandedCard(expandedCards, item.pagePath, props.onViewStateChange);
      }}
    >
      <div class="dreams-diary__insight-topline">
        <div class="dreams-diary__insight-title">${item.title}</div>
        <span class="dreams-diary__insight-badge dreams-diary__insight-badge--${badgeClass}">
          ${badgeLabel}
        </span>
      </div>
      <div class="dreams-diary__insight-meta">
        ${
          item.updatedAt ? formatCompactDateTime(item.updatedAt) : basename(item.pagePath)
        }${metadata}
      </div>
      ${renderWikiInsightBody(card, expanded)}
      <div class="dreams-diary__insight-actions">
        <button
          class="btn btn--subtle btn--sm"
          @click=${(event: Event) => {
            event.stopPropagation();
            toggleExpandedCard(expandedCards, item.pagePath, props.onViewStateChange);
          }}
        >
          ${expanded ? t("rings.wiki.hideDetails") : t("rings.wiki.details")}
        </button>
        <button
          class="btn btn--subtle btn--sm"
          @click=${(event: Event) => {
            event.stopPropagation();
            void openWikiPreview(item.pagePath, props);
          }}
        >
          ${t(
            card.kind === "import" ? "rings.wiki.openSourcePage" : "rings.wiki.openWikiPage",
          )}
        </button>
      </div>
    </article>
  `;
}

function renderDiaryNavigation(props: RingsProps, labels: string[], selectedPage: number) {
  const state = props.viewState;
  return html`
    <div class="dreams-diary__daychips">
      ${labels.map(
        (label, index) => html`
          <button
            class="dreams-diary__day-chip ${
              index === selectedPage ? "dreams-diary__day-chip--active" : ""
            }"
            @click=${() => {
              setDiaryPage(state, index, labels.length);
              props.onViewStateChange();
            }}
          >
            ${label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderWikiClusterSection<
  Cluster extends {
    key: string;
    label: string;
    itemCount: number;
    items: { pagePath: string }[];
  },
>(
  props: RingsProps,
  params: {
    kind: "imports" | "wiki";
    clusters: Cluster[];
    totalItems: number;
    truncated: boolean;
    loading: boolean;
    loadingKey: string;
    emptyKey: string;
    emptyHintKey: string;
    date: (cluster: Cluster) => string;
    prose: (cluster: Cluster) => ReturnType<typeof html>;
    renderItem: (item: Cluster["items"][number]) => ReturnType<typeof html>;
  },
): DiaryPanel {
  const { clusters } = params;
  if (clusters.length === 0) {
    return html`
      <div class="dreams-diary__empty">
        <div class="dreams-diary__empty-text">
          ${t(params.loading ? params.loadingKey : params.emptyKey)}
        </div>
        ${
          params.loading
            ? nothing
            : html`<div class="dreams-diary__empty-hint">${t(params.emptyHintKey)}</div>`
        }
      </div>
    `;
  }

  const state = props.viewState;
  const clusterIndex = Math.max(0, Math.min(state.diaryPage, clusters.length - 1));
  const cluster = expectDefined(
    clusters[clusterIndex],
    params.kind === "imports"
      ? "selected imported insight cluster"
      : "selected memory overview cluster",
  );
  const returnedItems = clusters.reduce((total, entry) => total + entry.itemCount, 0);
  return {
    navigation: renderDiaryNavigation(
      props,
      clusters.map((entry) => entry.label),
      clusterIndex,
    ),
    content: html`
      <article class="dreams-diary__entry" key="${params.kind}-${cluster.key}">
        <div class="dreams-diary__accent"></div>
        <div class="dreams-diary__date">${params.date(cluster)}</div>
        ${
          params.truncated
            ? html`<p class="dreams-diary__para dreams-diary__bounded-result">
                ${t("rings.wiki.boundedResults", {
                  returned: returnedItems.toLocaleString(i18n.getLocale()),
                  total: params.totalItems.toLocaleString(i18n.getLocale()),
                })}
              </p>`
            : nothing
        }
        <div class="dreams-diary__prose">${params.prose(cluster)}</div>
        <div class="dreams-diary__insights">${cluster.items.map(params.renderItem)}</div>
      </article>
    `,
  };
}

function renderDiaryImportsSection(props: RingsProps) {
  return renderWikiClusterSection(props, {
    kind: "imports",
    clusters: props.wikiImportInsights?.clusters ?? [],
    totalItems: props.wikiImportInsights?.totalItems ?? 0,
    truncated: props.wikiImportInsights?.truncated ?? false,
    loading: props.wikiImportInsightsLoading,
    loadingKey: "rings.wiki.loadingInsights",
    emptyKey: "rings.wiki.noInsights",
    emptyHintKey: "rings.wiki.noInsightsHint",
    date: (cluster) => {
      const metadata = [
        t("rings.wiki.counts.chats", { count: String(cluster.itemCount) }),
        ...(cluster.highRiskCount > 0
          ? [t("rings.wiki.counts.sensitive", { count: String(cluster.highRiskCount) })]
          : []),
        ...(cluster.preferenceSignalCount > 0
          ? [t("rings.wiki.counts.signals", { count: String(cluster.preferenceSignalCount) })]
          : []),
      ];
      return `${cluster.label} · ${metadata.join(" · ")}`;
    },
    prose: (cluster) => {
      const summary = [
        t("rings.wiki.importedClusterSummary", { label: cluster.label.toLowerCase() }),
        ...(cluster.withheldCount > 0
          ? [
              t(
                cluster.withheldCount === 1
                  ? "rings.wiki.withheldDigestOne"
                  : "rings.wiki.withheldDigests",
                { count: String(cluster.withheldCount) },
              ),
            ]
          : []),
      ];
      return html`<p class="dreams-diary__para">${summary.join(" ")}</p>`;
    },
    renderItem: (item) => renderWikiInsightCard(props, { kind: "import", item }),
  });
}

function renderWikiOverviewSection(props: RingsProps) {
  const overview = props.wikiOverview;
  return renderWikiClusterSection(props, {
    kind: "wiki",
    clusters: overview?.clusters ?? [],
    totalItems: overview?.totalItems ?? 0,
    truncated: overview?.truncated ?? false,
    loading: props.wikiOverviewLoading,
    loadingKey: "rings.wiki.loadingWiki",
    emptyKey: "rings.wiki.emptyWiki",
    emptyHintKey: "rings.wiki.emptyWikiHint",
    date: () => {
      const metadata = [
        formatWikiCount("page", overview?.totalPages ?? 0),
        ...((overview?.totalClaims ?? 0) > 0
          ? [formatWikiCount("claimRow", overview!.totalClaims)]
          : []),
        ...((overview?.totalQuestions ?? 0) > 0
          ? [formatWikiCount("openQuestion", overview!.totalQuestions)]
          : []),
        ...((overview?.totalContradictions ?? 0) > 0
          ? [formatWikiCount("contradiction", overview!.totalContradictions)]
          : []),
      ];
      return `${t("rings.wiki.vault")} · ${metadata.join(" · ")}`;
    },
    prose: (cluster) => html`
      <p class="dreams-diary__para">
        ${t("rings.wiki.fullVaultBreakdown", {
          breakdown: overview
            ? formatWikiOverviewPageBreakdown(overview.pageCounts)
            : t("rings.wiki.noPagesYet"),
        })}
      </p>
      <p class="dreams-diary__para">
        ${t("rings.wiki.selectedSection", {
          summary: formatWikiOverviewClusterSummary(cluster),
        })}
        ${
          cluster.updatedAt
            ? ` ${t("rings.wiki.latestUpdate", {
                date: formatCompactDateTime(cluster.updatedAt),
              })}`
            : ""
        }
      </p>
    `,
    renderItem: (item) => renderWikiInsightCard(props, { kind: "wiki", item }),
  });
}

function renderDreamDiaryEntries(props: RingsProps): DiaryPanel {
  const state = props.viewState;
  if (typeof props.dreamDiaryContent !== "string") {
    return html`
      <div class="dreams-diary__empty">
        <div class="dreams-diary__empty-moon">
          <svg viewBox="0 0 32 32" fill="none" width="32" height="32">
            <circle cx="16" cy="16" r="14" stroke="currentColor" stroke-width="0.5" opacity="0.2" />
            <path d="M20 8a10 10 0 0 1 0 16 10 10 0 1 0 0-16z" fill="currentColor" opacity="0.08" />
          </svg>
        </div>
        <div class="dreams-diary__empty-text">${t("rings.diary.noDreamsYet")}</div>
        <div class="dreams-diary__empty-hint">${t("rings.diary.noDreamsHint")}</div>
      </div>
    `;
  }

  const entries = parseDiaryEntries(props.dreamDiaryContent);
  if (entries.length === 0) {
    return html`
      <div class="dreams-diary__empty">
        <div class="dreams-diary__empty-text">${t("rings.diary.waitingTitle")}</div>
        <div class="dreams-diary__empty-hint">${t("rings.diary.waitingHint")}</div>
      </div>
    `;
  }

  const reversed = entries.toReversed();
  const page = Math.max(0, Math.min(state.diaryPage, reversed.length - 1));
  const entry = expectDefined(reversed[page], "selected rings diary entry");

  return {
    navigation: renderDiaryNavigation(
      props,
      reversed.map((diaryEntry) => formatDiaryChipLabel(diaryEntry.date)),
      page,
    ),
    content: html`
      <article class="dreams-diary__entry" key="${page}">
        <div class="dreams-diary__accent"></div>
        ${entry.date ? html`<time class="dreams-diary__date">${entry.date}</time>` : nothing}
        <div class="dreams-diary__prose">
          ${flattenDiaryBody(entry.body).map(
            (para, i) =>
              html`<p class="dreams-diary__para" style="animation-delay: ${0.3 + i * 0.15}s;">
                ${unsafeHTML(toSanitizedMarkdownHtml(para))}
              </p>`,
          )}
        </div>
      </article>
    `,
  };
}

function renderDiarySection(props: RingsProps) {
  const state = props.viewState;
  const activeDiarySubTab = state.activeDiarySubTab;
  const diary = {
    dreams: {
      error: props.dreamDiaryError,
      loading: props.dreamDiaryLoading,
      refresh: props.onRefreshDiary,
      render: renderDreamDiaryEntries,
      explainer: "rings.wiki.dreamsExplainer",
    },
    insights: {
      error: props.wikiImportInsightsError,
      loading: props.wikiImportInsightsLoading,
      refresh: props.onRefreshImports,
      render: renderDiaryImportsSection,
      explainer: "rings.wiki.insightsExplainer",
    },
    wiki: {
      error: props.wikiOverviewError,
      loading: props.wikiOverviewLoading,
      refresh: props.onRefreshWikiOverview,
      render: renderWikiOverviewSection,
      explainer: "rings.wiki.wikiExplainer",
    },
  }[activeDiarySubTab];
  const memoryWikiUnavailable = activeDiarySubTab !== "dreams" && !props.memoryWikiEnabled;
  if (diary.error && !memoryWikiUnavailable) {
    return html`
      <section class="dreams-diary">
        <div class="dreams-diary__error">${diary.error}</div>
      </section>
    `;
  }

  const diaryPanel = diary.render(props);
  const diaryNavigation = "navigation" in diaryPanel ? diaryPanel.navigation : nothing;
  const diaryContent = "content" in diaryPanel ? diaryPanel.content : diaryPanel;

  return html`
    <section class="dreams-diary">
      <div class="dreams-diary__chrome">
        <div class="dreams-diary__header">
          <span class="dreams-diary__title">${t("rings.diary.title")}</span>
          ${renderHubTabs({
            id: "dream-diary",
            active: activeDiarySubTab,
            tabs: [
              { value: "dreams", label: t("rings.wiki.dreamsTab") },
              { value: "insights", label: t("rings.wiki.insightsTab") },
              { value: "wiki", label: t("rings.wiki.wikiTab") },
            ],
            ariaLabel: t("rings.diary.title"),
            panelId: "dream-diary-panel",
            variant: "sub",
            onSelect: (tab) => {
              resetWikiPreview(state);
              state.activeDiarySubTab = tab;
              state.diaryPage = 0;
              props.onViewStateChange();
            },
          })}
          <button
            class="btn btn--subtle btn--sm"
            ?disabled=${
              memoryWikiUnavailable
                ? !props.access.canOpenConfig
                : props.modeSaving || diary.loading
            }
            @click=${() => {
              state.diaryPage = 0;
              if (memoryWikiUnavailable) {
                props.onOpenConfig();
              } else {
                diary.refresh();
              }
            }}
          >
            ${
              memoryWikiUnavailable
                ? t("rings.wiki.howToEnable")
                : activeDiarySubTab === "dreams"
                  ? diary.loading
                    ? t("rings.diary.reloading")
                    : t("rings.diary.reload")
                  : diary.loading
                    ? "Reloading…"
                    : "Reload"
            }
          </button>
        </div>
        <p class="dreams-diary__explainer">${t(diary.explainer)}</p>
        ${memoryWikiUnavailable ? nothing : diaryNavigation}
      </div>

      <div
        id="dream-diary-panel"
        role="tabpanel"
        aria-labelledby=${`dream-diary-tab-${activeDiarySubTab}`}
      >
        ${
          memoryWikiUnavailable
            ? html`
                <div class="dreams-diary__empty">
                  <div class="dreams-diary__empty-text">${t("rings.wiki.unavailable")}</div>
                  <div class="dreams-diary__empty-hint">
                    ${t("rings.wiki.unavailablePluginPrefix")}
                    <code>memory-wiki</code> ${t("rings.wiki.unavailablePluginSuffix")}
                  </div>
                  <div class="dreams-diary__empty-hint">
                    ${t("rings.wiki.enablePrefix")}
                    <code>plugins.entries.memory-wiki.enabled = true</code>${t(
                      "rings.wiki.enableSuffix",
                    )}
                  </div>
                  <div class="dreams-diary__empty-actions">
                    <button
                      class="btn btn--subtle btn--sm"
                      ?disabled=${!props.access.canOpenConfig}
                      @click=${() => props.onOpenConfig()}
                    >
                      ${t("rings.wiki.openConfig")}
                    </button>
                  </div>
                </div>
              `
            : diaryContent
        }
      </div>
      ${renderWikiPreviewOverlay(props)}
    </section>
  `;
}
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
