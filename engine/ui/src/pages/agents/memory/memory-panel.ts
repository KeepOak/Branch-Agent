import { consume } from "@lit/context";
import { asOptionalObjectRecord } from "@branch/normalization-core/record-coerce";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { html, type PropertyValues } from "lit";
import { property, state } from "lit/decorators.js";
import {
  applicationContext,
  type ApplicationContext,
  type ApplicationGateway,
  type ApplicationGatewaySnapshot,
} from "../../../app/context.ts";
import { shellLayoutTraits } from "../../../app/shell-layout-traits.ts";
import {
  showConfirmDialog,
  type ConfirmDialogOptions,
} from "../../../components/confirm-dialog.ts";
import { renderSettingsDefaultDescription } from "../../../components/settings-ui.ts";
import { t } from "../../../i18n/index.ts";
import { registerRingsEnglish } from "../../../i18n/locales/en-rings.ts";
import { currentConfigObject } from "../../../lib/config/config-state-model.ts";
import { formatTimeMs } from "../../../lib/format.ts";
import { isPluginEnabledInConfigSnapshot } from "../../../lib/plugin-activation.ts";
import { GatewayPageController } from "../../../lit/gateway-page-controller.ts";
import { BranchLightDomElement } from "../../../lit/branch-element.ts";
import { SubscriptionsController } from "../../../lit/subscriptions-controller.ts";
import {
  backfillDreamDiary,
  canCallRingsMethod,
  copyRingsArchivePath,
  createRingsState,
  dedupeDreamDiary,
  loadDreamDiary,
  loadRingsStatus,
  loadWikiImportInsights,
  loadWikiOverview,
  repairRingsArtifacts,
  resetGroundedShortTerm,
  resetDreamDiary,
  resolveConfiguredRings,
  updateRingsEnabled,
  type RingsState,
  type WikiPagePreview,
} from "./rings.ts";
import { renderRingsToggleConfirmation } from "./toggle-confirmation.ts";
import {
  createRingsViewState,
  renderRings,
  resetWikiPreview,
  type RingsViewState,
} from "./view.ts";

registerRingsEnglish();

type RingsTaskScope = {
  gateway: ApplicationGateway;
  epoch: number;
  state: RingsState;
};

function resolveRingsNextCycle(status: RingsState["ringsStatus"]): string | null {
  const nextRunAtMs = Object.values(status?.phases ?? {})
    .flatMap((phase) =>
      phase.enabled && typeof phase.nextRunAtMs === "number" ? [phase.nextRunAtMs] : [],
    )
    .toSorted((a, b) => a - b)[0];
  return formatTimeMs(nextRunAtMs, { hour: "numeric", minute: "2-digit" }, "") || null;
}

function readWikiPagePreview(value: unknown, lookup: string): WikiPagePreview {
  const payload = asOptionalObjectRecord(value);
  const title = normalizeOptionalString(payload?.title) ?? lookup;
  const path = normalizeOptionalString(payload?.path) ?? lookup;
  const content =
    typeof payload?.content === "string" && payload.content.length > 0
      ? payload.content
      : t("rings.wiki.noContent");
  const updatedAt = normalizeOptionalString(payload?.updatedAt);
  const totalLines =
    typeof payload?.totalLines === "number" && Number.isFinite(payload.totalLines)
      ? Math.max(0, Math.floor(payload.totalLines))
      : undefined;
  return {
    title,
    path,
    content,
    ...(totalLines === undefined ? {} : { totalLines }),
    ...(payload?.truncated === true ? { truncated: true } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

class AgentMemoryPanel extends BranchLightDomElement {
  @consume({ context: applicationContext, subscribe: true })
  private context!: ApplicationContext;

  @property({ attribute: false }) agentId = "";

  @state() private rings = createRingsState();
  @state() private toggleConfirmOpen = false;
  @state() private toggleConfirmLoading = false;
  @state() private pendingEnabled: boolean | null = null;

  private readonly viewState: RingsViewState = createRingsViewState();
  private readonly gateway = new GatewayPageController(this, {
    getGateway: () => this.context?.gateway,
    onSnapshot: ({ snapshot, initial, sourceChanged }) =>
      this.applyGatewaySnapshot(
        snapshot,
        initial ? "initial" : sourceChanged ? "replacement" : undefined,
      ),
  });
  private selectedAgentId: string | null = null;
  private readonly subscriptions = new SubscriptionsController(this).effect(
    () => this.context?.runtimeConfig,
    (runtimeConfig) => {
      this.syncConfigSnapshot();
      return runtimeConfig.subscribe(() => {
        this.syncConfigSnapshot();
        this.requestUpdate();
      });
    },
  );

  override updated(changed: PropertyValues<this>) {
    if (changed.has("agentId")) {
      this.applyAgentId();
    }
  }

  override disconnectedCallback() {
    this.subscriptions.clear();
    this.resetTransientState();
    this.rings = createRingsState();
    super.disconnectedCallback();
  }

  private captureTaskScope(): RingsTaskScope | null {
    const gateway = this.gateway.gateway;
    if (!gateway) {
      return null;
    }
    return { gateway, epoch: this.gateway.epoch, state: this.rings };
  }

  private isTaskScopeCurrent(scope: RingsTaskScope): boolean {
    return (
      this.isConnected &&
      this.gateway.gateway === scope.gateway &&
      this.gateway.epoch === scope.epoch &&
      this.context.gateway === scope.gateway &&
      this.rings === scope.state
    );
  }

  private resetTransientState() {
    resetWikiPreview(this.viewState);
    this.toggleConfirmOpen = false;
    this.toggleConfirmLoading = false;
    this.pendingEnabled = null;
  }

  private createGatewayState(snapshot = this.context.gateway.snapshot): RingsState {
    return createRingsState({
      client: snapshot.client,
      connected: snapshot.phase === "connected",
      hello: snapshot.hello,
      configSnapshot: this.context.runtimeConfig.state.configSnapshot,
      selectedAgentId: this.selectedAgentId,
    });
  }

  private applyGatewaySnapshot(
    snapshot: ApplicationGatewaySnapshot,
    sourceBind?: "initial" | "replacement",
  ) {
    const clientChanged = this.rings.client !== snapshot.client;
    const connectionChanged = this.rings.connected !== (snapshot.phase === "connected");
    const replaceState = sourceBind === "replacement" || clientChanged || connectionChanged;
    if (replaceState) {
      this.rings = this.createGatewayState(snapshot);
      if (sourceBind !== "initial") {
        this.resetTransientState();
      }
    } else {
      this.rings.connected = snapshot.phase === "connected";
      this.rings.hello = snapshot.hello;
    }
    if (snapshot.phase === "connected" && this.selectedAgentId && replaceState) {
      void this.loadAll();
    }
    this.requestUpdate();
  }

  private applyAgentId() {
    const agentId = this.agentId.trim() || null;
    if (this.selectedAgentId === agentId) {
      return;
    }
    this.selectedAgentId = agentId;
    this.gateway.invalidate();
    this.resetTransientState();
    this.rings = this.createGatewayState();
    if (agentId && this.rings.connected) {
      void this.loadAll();
    }
  }

  private syncConfigSnapshot() {
    this.rings.configSnapshot = this.context.runtimeConfig.state.configSnapshot;
  }

  private async runRingsTask<T>(
    task: (state: RingsState) => Promise<T>,
    scope = this.captureTaskScope(),
  ): Promise<T | undefined> {
    if (!scope || !this.isTaskScopeCurrent(scope)) {
      return undefined;
    }
    const result = task(scope.state);
    this.requestUpdate();
    try {
      const value = await result;
      return this.isTaskScopeCurrent(scope) ? value : undefined;
    } finally {
      if (this.isTaskScopeCurrent(scope)) {
        this.requestUpdate();
      }
    }
  }

  private async confirmRingsTask(
    task: (state: RingsState) => Promise<boolean>,
    confirmation: ConfirmDialogOptions,
  ) {
    const scope = this.captureTaskScope();
    if (!scope || !(await showConfirmDialog(confirmation)) || !this.isTaskScopeCurrent(scope)) {
      return;
    }
    await this.runRingsTask(task, scope);
  }

  private async loadAll(refreshConfig = false) {
    const scope = this.captureTaskScope();
    if (!scope || !scope.state.client || !scope.state.connected || !scope.state.selectedAgentId) {
      return;
    }
    const runtimeConfig = this.context.runtimeConfig;
    if (refreshConfig) {
      await runtimeConfig.refresh();
    } else {
      await runtimeConfig.ensureLoaded();
    }
    if (!this.isTaskScopeCurrent(scope) || this.context.runtimeConfig !== runtimeConfig) {
      return;
    }
    this.syncConfigSnapshot();
    await Promise.all([
      this.runRingsTask(loadRingsStatus, scope),
      this.runRingsTask(loadDreamDiary, scope),
      this.runRingsTask(loadWikiImportInsights, scope),
      this.runRingsTask(loadWikiOverview, scope),
    ]);
  }

  private setEnabled(enabled: boolean, ringsOn: boolean) {
    if (
      !canCallRingsMethod(this.rings, "config.patch", "operator.admin") ||
      this.rings.ringsModeSaving ||
      this.toggleConfirmLoading ||
      this.toggleConfirmOpen ||
      ringsOn === enabled
    ) {
      return;
    }
    this.pendingEnabled = enabled;
    this.toggleConfirmOpen = true;
    this.rings.ringsStatusError = null;
  }

  private cancelToggle() {
    if (this.toggleConfirmLoading) {
      return;
    }
    this.toggleConfirmOpen = false;
    this.pendingEnabled = null;
    this.rings.ringsStatusError = null;
  }

  private async confirmToggle() {
    const enabled = this.pendingEnabled;
    if (
      enabled == null ||
      this.toggleConfirmLoading ||
      !canCallRingsMethod(this.rings, "config.patch", "operator.admin")
    ) {
      return;
    }
    this.toggleConfirmLoading = true;
    this.rings.ringsStatusError = null;
    const scope = this.captureTaskScope();
    const runtimeConfig = this.context.runtimeConfig;
    if (!scope) {
      this.toggleConfirmLoading = false;
      return;
    }
    try {
      const canDispatch = () =>
        this.isTaskScopeCurrent(scope) &&
        this.context.runtimeConfig === runtimeConfig &&
        canCallRingsMethod(scope.state, "config.patch", "operator.admin");
      const updated = await this.runRingsTask(
        (ringsState) =>
          updateRingsEnabled(ringsState, runtimeConfig, enabled, canDispatch),
        scope,
      );
      if (!this.isTaskScopeCurrent(scope) || this.context.runtimeConfig !== runtimeConfig) {
        return;
      }
      if (!updated) {
        this.rings.ringsStatusError ??= t("rings.toggleConfirmation.failed");
        return;
      }
      await runtimeConfig.refresh();
      if (!this.isTaskScopeCurrent(scope) || this.context.runtimeConfig !== runtimeConfig) {
        return;
      }
      this.syncConfigSnapshot();
      await this.runRingsTask(loadRingsStatus, scope);
      if (!this.isTaskScopeCurrent(scope)) {
        return;
      }
      this.toggleConfirmOpen = false;
      this.pendingEnabled = null;
    } finally {
      if (this.isTaskScopeCurrent(scope)) {
        this.toggleConfirmLoading = false;
      }
    }
  }

  private async openWikiPage(lookup: string): Promise<WikiPagePreview | null> {
    const scope = this.captureTaskScope();
    const client = scope?.state.client;
    const agentId = scope?.state.selectedAgentId;
    if (!scope || !client || !scope.state.connected || !agentId) {
      return null;
    }
    const payload = await client.request("wiki.get", {
      lookup,
      fromLine: 1,
      lineCount: 5000,
      agentId,
    });
    if (!this.isTaskScopeCurrent(scope) || scope.state.selectedAgentId !== agentId) {
      return null;
    }
    return readWikiPagePreview(payload, lookup);
  }

  private async refreshWikiData(task: (state: RingsState) => Promise<void>) {
    const scope = this.captureTaskScope();
    if (!scope?.state.selectedAgentId) {
      return;
    }
    const runtimeConfig = this.context.runtimeConfig;
    await runtimeConfig.refresh();
    if (!this.isTaskScopeCurrent(scope) || this.context.runtimeConfig !== runtimeConfig) {
      return;
    }
    this.syncConfigSnapshot();
    await this.runRingsTask(task, scope);
  }

  override render() {
    const rings = this.rings;
    const configState = this.context.runtimeConfig.state;
    const configuredRings = resolveConfiguredRings(currentConfigObject(configState));
    // The status RPC can complete after config switches the engine Off. Keep the
    // cached payload for a future refresh, but never present it as current runtime state.
    const ringsStatus = configuredRings.engineOff ? null : rings.ringsStatus;
    const ringsOn = ringsStatus?.enabled ?? configuredRings.enabled;
    const loading = rings.ringsStatusLoading || rings.ringsModeSaving;
    const canUpdateConfig = canCallRingsMethod(rings, "config.patch", "operator.admin");
    const refreshLoading = rings.ringsStatusLoading || rings.dreamDiaryLoading;
    const selectedAgentId = rings.selectedAgentId ?? "";

    return html`
      <section
        class="content-header content-header--page agent-memory-panel__header"
        ${shellLayoutTraits({ toolbarHeader: true })}
      >
        <div class="page-meta">
          <div class="rings-header-controls">
            <button
              class="btn btn--subtle btn--sm"
              ?disabled=${loading || rings.dreamDiaryLoading}
              @click=${() => void this.loadAll(true)}
            >
              ${refreshLoading ? t("rings.header.refreshing") : t("rings.header.refresh")}
            </button>
            <span class="muted">
              ${
                configuredRings.engineOff
                  ? t("rings.header.engineOff")
                  : renderSettingsDefaultDescription(
                      t("common.enabled"),
                      configuredRings.overridden,
                    )
              }
            </span>
            <button
              class="dreams__phase-toggle ${ringsOn ? "dreams__phase-toggle--on" : ""}"
              ?disabled=${!canUpdateConfig || loading || configuredRings.engineOff}
              @click=${() => this.setEnabled(!ringsOn, ringsOn)}
            >
              <span class="dreams__phase-toggle-dot"></span>
              <span class="dreams__phase-toggle-label">
                ${ringsOn ? t("rings.header.on") : t("rings.header.off")}
              </span>
            </button>
          </div>
        </div>
      </section>
      ${renderRings({
        access: {
          canOpenConfig: canCallRingsMethod(rings, "config.openFile", "operator.admin", {
            requireAdvertisement: false,
          }),
          canBackfillDiary: canCallRingsMethod(
            rings,
            "doctor.memory.backfillDreamDiary",
            "operator.write",
          ),
          canDedupeDreamDiary: canCallRingsMethod(
            rings,
            "doctor.memory.dedupeDreamDiary",
            "operator.write",
          ),
          canResetDiary: canCallRingsMethod(
            rings,
            "doctor.memory.resetDreamDiary",
            "operator.write",
          ),
          canResetGroundedShortTerm: canCallRingsMethod(
            rings,
            "doctor.memory.resetGroundedShortTerm",
            "operator.write",
          ),
          canRepairRingsArtifacts: canCallRingsMethod(
            rings,
            "doctor.memory.repairRingsArtifacts",
            "operator.write",
          ),
        },
        viewState: this.viewState,
        active: ringsOn,
        selectedAgentId,
        shortTermCount: ringsStatus?.shortTermCount ?? 0,
        promotedCount: ringsStatus?.promotedToday ?? 0,
        phases: ringsStatus?.phases ?? undefined,
        shortTermEntries: ringsStatus?.shortTermEntries ?? [],
        promotedEntries: ringsStatus?.promotedEntries ?? [],
        nextCycle: resolveRingsNextCycle(ringsStatus),
        timezone: ringsStatus?.timezone ?? null,
        statusError: rings.ringsStatusError,
        modeSaving: rings.ringsModeSaving,
        dreamDiaryLoading: rings.dreamDiaryLoading,
        dreamDiaryActionLoading: rings.dreamDiaryActionLoading,
        dreamDiaryActionMessage: rings.dreamDiaryActionMessage,
        dreamDiaryActionArchivePath: rings.dreamDiaryActionArchivePath,
        dreamDiaryError: rings.dreamDiaryError,
        dreamDiaryContent: rings.dreamDiaryContent,
        memoryWikiEnabled: isPluginEnabledInConfigSnapshot(
          configState.configSnapshot,
          "memory-wiki",
          { enabledByDefault: false },
        ),
        wikiImportInsightsLoading: rings.wikiImportInsightsLoading,
        wikiImportInsightsError: rings.wikiImportInsightsError,
        wikiImportInsights: rings.wikiImportInsights,
        wikiOverviewLoading: rings.wikiOverviewLoading,
        wikiOverviewError: rings.wikiOverviewError,
        wikiOverview: rings.wikiOverview,
        onRefreshDiary: () => void this.runRingsTask(loadDreamDiary),
        onRefreshImports: () => void this.refreshWikiData(loadWikiImportInsights),
        onRefreshWikiOverview: () => void this.refreshWikiData(loadWikiOverview),
        onOpenConfig: () => void this.context.runtimeConfig.openFile(),
        onOpenWikiPage: (lookup) => this.openWikiPage(lookup),
        onBackfillDiary: () => void this.runRingsTask(backfillDreamDiary),
        onCopyRingsArchivePath: () => void this.runRingsTask(copyRingsArchivePath),
        onDedupeDreamDiary: () =>
          void this.confirmRingsTask(dedupeDreamDiary, {
            title: t("rings.scene.dedupeDiary"),
            message: t("rings.actions.confirmDedupeDescription"),
            confirmLabel: t("rings.scene.dedupeDiary"),
            danger: true,
          }),
        onResetDiary: () => void this.runRingsTask(resetDreamDiary),
        onResetGroundedShortTerm: () => void this.runRingsTask(resetGroundedShortTerm),
        onRepairRingsArtifacts: () =>
          void this.confirmRingsTask(repairRingsArtifacts, {
            title: t("rings.scene.repairCache"),
            message: t("rings.actions.confirmRepairDescription"),
            confirmLabel: t("rings.scene.repairCache"),
          }),
        onViewStateChange: () => this.requestUpdate(),
      })}
      ${renderRingsToggleConfirmation({
        open: this.toggleConfirmOpen,
        enabling: this.pendingEnabled === true,
        loading: this.toggleConfirmLoading,
        onConfirm: () => void this.confirmToggle(),
        onCancel: () => this.cancelToggle(),
        hasError: Boolean(rings.ringsStatusError),
      })}
    `;
  }
}

if (!customElements.get("branch-agent-memory-panel")) {
  customElements.define("branch-agent-memory-panel", AgentMemoryPanel);
}
