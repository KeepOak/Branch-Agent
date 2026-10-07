import { ensureAuthProfileStore, resolveAuthProfileOrder } from "../agents/auth-profiles.js";
import { listAgentIds, resolveAgentDir, resolveAgentExplicitModelPrimary, setAgentEffectiveModelPrimary } from "../agents/agent-scope.js";
import { runAuthProbes } from "../commands/models/list.probe.js";
import { getRuntimeConfig, mutateConfigFileWithRetry } from "../config/config.js";
import { resolveIsConfigReadOnly } from "../config/paths.js";
import { readModelUpgradeState, writeModelUpgradeState } from "./model-upgrade-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("model-upgrade-probe");
const DAY_MS = 24 * 60 * 60_000;
const OLD = "openai/gpt-6-sol";
const NEW = "openai/gpt-6.1-sol";

/** One cheap Codex-harness request per ordered ChatGPT account, at most daily. */
export async function runDailyModelUpgradeProbe(now = Date.now()): Promise<void> {
  if (resolveIsConfigReadOnly()) return;
  const previous = await readModelUpgradeState();
  if (previous.checkedAt && now - previous.checkedAt < DAY_MS) return;
  const cfg = getRuntimeConfig();
  const agentId = listAgentIds(cfg)[0];
  if (!agentId) return;
  const defaultPrimary = typeof cfg.agents?.defaults?.model === "string"
    ? cfg.agents.defaults.model : cfg.agents?.defaults?.model?.primary;
  const candidates = listAgentIds(cfg).filter((id) => resolveAgentExplicitModelPrimary(cfg, id) === OLD);
  if (defaultPrimary !== OLD && candidates.length === 0) return;
  const agentDir = resolveAgentDir(cfg, agentId);
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const profileIds = resolveAuthProfileOrder({ cfg, store, provider: "openai" })
    .filter((id) => store.profiles[id]?.type === "oauth");
  if (!profileIds.length) return;
  await writeModelUpgradeState({ ...previous, checkedAt: now });
  try {
    const summary = await runAuthProbes({ cfg, agentId, agentDir, providers: ["openai"],
      modelCandidates: [NEW], options: { provider: "openai", profileIds,
        timeoutMs: 20_000, concurrency: 1, maxTokens: 8, agentHarnessRuntimeOverride: "codex" } });
    const accepted = profileIds.every((id) => summary.results.some((result) =>
      result.profileId === id && result.model === NEW && result.status === "ok"));
    log.info(`daily ${NEW} Codex probe: ${summary.results.map((result) => `${result.profileId ?? result.source}=${result.status}`).join(", ")}`);
    if (!accepted) return;
    const changed = await mutateConfigFileWithRetry<number>({ afterWrite: { mode: "auto" }, mutate: (draft) => {
      let count = 0;
      const primary = typeof draft.agents?.defaults?.model === "string"
        ? draft.agents.defaults.model : draft.agents?.defaults?.model?.primary;
      if (primary === OLD) {
        setAgentEffectiveModelPrimary(draft, agentId, NEW, { target: "defaults" });
        count++;
      }
      for (const id of listAgentIds(draft)) {
        if (resolveAgentExplicitModelPrimary(draft, id) !== OLD) continue;
        setAgentEffectiveModelPrimary(draft, id, NEW, { target: "agent" });
        count++;
      }
      return count;
    } });
    if (changed.result) {
      // Config writes rotate the previous config to .bak; retain a visible record for Inbox.
      await writeModelUpgradeState({ checkedAt: now, notice: `GPT-6.1 Sol is now available. ${changed.result} model setting${changed.result === 1 ? "" : "s"} switched from GPT-6 Sol; the previous config is backed up.` });
    }
  } catch (error) {
    log.warn(`daily ${NEW} probe failed: ${String(error)}`);
  }
}
