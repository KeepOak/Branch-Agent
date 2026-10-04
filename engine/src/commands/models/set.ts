import {
  findNormalizedProviderValue,
  parseModelRef,
} from "../../agents/model-selection-normalize.js";
import { formatModelSuitabilityWarning } from "../../agents/model-suitability.js";
import { logConfigUpdated } from "../../config/logging.js";
import { resolveAgentModelPrimaryValue } from "../../config/model-input.js";
import type { RuntimeEnv } from "../../runtime.js";
import { repairCodexRuntimePluginInstallForModelSelection } from "../codex-runtime-plugin-install.js";
import { repairCopilotRuntimePluginInstallForModelSelection } from "../copilot-runtime-plugin-install.js";
import { updateDefaultModelPrimaryConfig } from "./shared.js";

export async function modelsSetCommand(modelRaw: string, runtime: RuntimeEnv) {
  const { updated, warning: catalogWarning } = await updateDefaultModelPrimaryConfig({
    modelRaw,
    field: "model",
  });
  if (catalogWarning) {
    runtime.error?.(catalogWarning);
  }
  const selectedModel = resolveAgentModelPrimaryValue(updated.agents?.defaults?.model) ?? modelRaw;
  const selectedRef = parseModelRef(selectedModel, "");
  if (selectedRef) {
    const name = findNormalizedProviderValue(
      updated.models?.providers,
      selectedRef.provider,
    )?.models?.find((entry) => entry.id === selectedRef.model)?.name;
    const warning = formatModelSuitabilityWarning({ ...selectedRef, name });
    if (warning) {
      runtime.error?.(warning);
    }
  }
  const repaired = await repairCodexRuntimePluginInstallForModelSelection({
    cfg: updated,
    model: selectedModel,
  });
  const copilotRepaired = await repairCopilotRuntimePluginInstallForModelSelection({
    cfg: updated,
    model: selectedModel,
  });
  const warnings = [...repaired.warnings, ...copilotRepaired.warnings];
  for (const warning of warnings) {
    runtime.error?.(warning);
  }

  logConfigUpdated(runtime);
  runtime.log(`Default model: ${selectedModel}`);
}
