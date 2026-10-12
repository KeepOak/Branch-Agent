// The model and thinking chip (DESIGN-SPEC §4.3.4): projections of models.list and the session row.
import { list, rec, str, type Rec } from "./engine";
import { readModelRuntimeMetadata, type ModelRuntimeMetadata } from "./model-capabilities";
import { displayModelName } from "./model-display";

export type Level = { id: string; label: string };

export type ModelChoice = {
  /** "<provider>/<id>", the value sessions.patch { model } takes. */
  ref: string;
  id: string;
  name: string;
  provider: string;
  local: boolean;
  available: boolean;
  supportsTools: boolean;
  supportsFastMode: boolean;
  levels: Level[];
  thinkingDefault: string;
  contextWindows: Level[];
  contextWindowDefault: string;
  /** Account-scoped service tiers; "ultrafast" means the account offers Ultrafast. */
  serviceTiers: string[];
  /** Read-only public capabilities for each advertised runtime; never merged across routes. */
  runtimeMetadata?: ModelRuntimeMetadata;
};

function levels(v: unknown): Level[] {
  return list(v)
    .map((l) => ({ id: str(l.id), label: str(l.label) || str(l.id) }))
    .filter((l) => l.id);
}

export function readModel(r: Rec): ModelChoice | null {
  const id = str(r.id);
  const provider = str(r.provider);
  if (!id || !provider) {
    return null;
  }
  return {
    ref: `${provider}/${id}`,
    id,
    name: displayModelName(str(r.name) || id),
    provider,
    local: r.local === true,
    available: r.available !== false,
    supportsTools: r.supportsTools !== false,
    supportsFastMode: r.supportsFastMode === true,
    levels: levels(r.thinkingLevels),
    thinkingDefault: str(r.thinkingDefault),
    contextWindows: levels(r.contextWindows),
    contextWindowDefault: str(r.contextWindowDefault),
    serviceTiers: Array.isArray(r.serviceTiers) ? r.serviceTiers.map(str) : [],
    runtimeMetadata: readModelRuntimeMetadata(r),
  };
}

/** The models a person may pick here (models.list rows; `manualSelectionAllowed: false` rows are kept out). */
export function readModels(result: unknown): ModelChoice[] {
  return list(rec(result).models)
    .filter((r) => r.manualSelectionAllowed !== false)
    .map(readModel)
    .filter((m): m is ModelChoice => m !== null);
}

/** The model this conversation uses: the session row's, else the engine's default for new conversations. */
export function currentModelRef(row: Rec, defaults: Rec, trunkModel?: string): string {
  const override = str(row.modelOverride);
  const provider = str(row.providerOverride) || str(row.modelProvider) || str(defaults.modelProvider);
  const model = override || trunkModel || str(row.model) || str(defaults.model);
  if (!model) {
    return "";
  }
  return model.includes("/") || !provider ? model : `${provider}/${model}`;
}

/** The thinking level in effect: the session's own, else the model's default. */
export function currentThinking(row: Rec, defaults: Rec): string {
  return str(row.thinkingLevel) || str(row.thinkingDefault) || str(defaults.thinkingDefault);
}

/** Preview §4.3.4 / rule 13: the chip when no usable model is connected. */
export const NO_MODEL_CHIP = "No model";

/** "<model> · <thinking>" in lower case for the level (§4.3.4 rule 1). */
export function chipLabel(modelName: string, thinking: string): string {
  if (!modelName) {
    return "";
  }
  return thinking ? `${modelName} · ${thinking.toLowerCase()}` : modelName;
}

/** The composer chip names a model only when that model is in models.list and available. */
export function composerChipLabel(current: ModelChoice | undefined, thinking: string, modelsLoaded: boolean): string {
  if (current?.available) {
    return chipLabel(current.name, thinking);
  }
  return modelsLoaded ? NO_MODEL_CHIP : "";
}

/** The service a model belongs to, as the group label in the model menu. */
export function serviceName(m: ModelChoice): string {
  return m.local ? "On this computer" : m.provider;
}

/** The one-line account line under a model in the menu. */
export function accountLine(m: ModelChoice): string {
  return m.local ? "On this computer · free · private" : m.provider;
}

export function groupModels(models: readonly ModelChoice[], query: string): Array<{ service: string; models: ModelChoice[] }> {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, ModelChoice[]>();
  for (const m of models) {
    if (q && !`${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(q)) {
      continue;
    }
    const service = serviceName(m);
    groups.set(service, [...(groups.get(service) ?? []), m]);
  }
  return [...groups].map(([service, models]) => ({ service, models }));
}

/** The levels to offer: exactly the ones the engine lists for the model (sessions.patch rejects any other). */
export function thinkingChoices(m: ModelChoice | undefined): Level[] {
  return m ? m.levels : [];
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
