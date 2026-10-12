import fs from "node:fs";
import { createTwoFilesPatch } from "diff";
import type { ModelCatalog } from "../../packages/model-catalog-core/src/model-catalog-types.js";
import { planManifestModelCatalogRows } from "../../src/model-catalog/manifest-planner.js";
import { readModelCatalogManifests } from "../publish-model-catalog.mts";

type Metadata = Record<string, unknown>;
const FIELD_NAMES: Record<string, string> = {
  max_input_tokens: "contextWindow",
  max_output_tokens: "maxTokens",
  supports_reasoning: "reasoning",
  supported_input_modalities: "input",
};
const PRICE_NAMES: Record<string, string> = {
  input_cost_per_token: "input",
  output_cost_per_token: "output",
  cache_read_input_token_cost: "cacheRead",
  cache_creation_input_token_cost: "cacheWrite",
};
export type BundledMetadata = {
  ref: string;
  provider: string;
  id: string;
  manifestPath: string;
  metadata: Metadata;
};
export type MetadataComparison = {
  bundled: BundledMetadata;
  identical: boolean;
  diff: string;
};

function record(value: unknown, label: string): Metadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Metadata;
}

function providerModels(value: unknown, label: string): Metadata[] {
  const provider = record(value, label);
  if (!Array.isArray(provider.models)) {
    throw new Error(`${label}.models must be an array`);
  }
  return provider.models.map((value) => {
    const model = record(value, `${label} model`);
    if (typeof model.id !== "string" || !model.id.trim()) {
      throw new Error(`${label} model requires an id`);
    }
    return model;
  });
}

function manifestEntries(
  input: ReturnType<typeof readModelCatalogManifests>[number],
): BundledMetadata[] {
  const providers = input.manifest.modelCatalog?.providers ?? {};
  return Object.entries(providers).flatMap(([provider, value]) =>
    providerModels(value, `${input.manifestPath}: ${provider}`).map((model) => {
      const { id, ...metadata } = model;
      return {
        ref: `${provider}/${String(id)}`,
        provider,
        id: String(id),
        manifestPath: input.manifestPath,
        metadata,
      };
    }),
  );
}

/** Plans every bundled local row without loading remote overlays or provider runtimes. */
export function readBundledMetadata(rootDir: string): BundledMetadata[] {
  const manifests = readModelCatalogManifests({ rootDir });
  const entries = manifests.flatMap(manifestEntries);
  const plan = planManifestModelCatalogRows({
    registry: {
      plugins: manifests.map(({ pluginId, manifest }) => ({
        id: pluginId,
        providers: manifest.providers,
        modelCatalog: manifest.modelCatalog as ModelCatalog | undefined,
      })),
    },
  });
  const eligible = new Set(plan.rows.map((row) => row.ref));
  return entries.filter((entry) => eligible.has(entry.ref));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sorted);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => lexicalCompare(a, b))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serialized(value: unknown): string {
  return `${JSON.stringify(sorted(value), null, 4)}\n`;
}

function perMillion(value: number): number {
  const decimal = String(value);
  const position = decimal.indexOf("e");
  const coefficient = position < 0 ? decimal : decimal.slice(0, position);
  const exponent = position < 0 ? 0 : Number(decimal.slice(position + 1));
  return Number(`${coefficient}e${exponent + 6}`);
}

function liteLLMMetadata(value: unknown): Metadata {
  const source = { ...record(value, "LiteLLM model metadata") };
  delete source.litellm_provider;
  const metadata: Metadata = Object.create(null) as Metadata;
  const cost: Metadata = Object.create(null) as Metadata;
  for (const [key, value] of Object.entries(source)) {
    const price = Object.hasOwn(PRICE_NAMES, key) ? PRICE_NAMES[key] : undefined;
    const renamed = Object.hasOwn(FIELD_NAMES, key) ? FIELD_NAMES[key] : undefined;
    const rate =
      price && typeof value === "number" && Number.isFinite(value) ? perMillion(value) : undefined;
    if (price && !Object.hasOwn(source, "cost") && rate !== undefined && Number.isFinite(rate)) {
      cost[price] = rate;
    } else if (
      key === "supports_vision" &&
      typeof value === "boolean" &&
      !Object.hasOwn(source, "supported_input_modalities") &&
      !Object.hasOwn(source, "input")
    ) {
      metadata.input = value ? ["text", "image"] : ["text"];
    } else {
      // Retain unmapped metadata: cross-schema fields must remain visible in the diff.
      metadata[renamed && !Object.hasOwn(source, renamed) ? renamed : key] = value;
    }
  }
  if (Object.keys(cost).length) {
    metadata.cost = cost;
  }
  return metadata;
}

function liteLLMEntries(value: unknown, bundledRefs: ReadonlySet<string>): Map<string, Metadata> {
  const entries = new Map<string, Metadata>();
  for (const [id, raw] of Object.entries(record(value, "LiteLLM snapshot"))) {
    const provider =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Metadata).litellm_provider
        : undefined;
    const ref =
      typeof provider === "string" && !id.startsWith(`${provider}/`) ? `${provider}/${id}` : id;
    if (!bundledRefs.has(ref)) {
      continue;
    }
    const model = record(raw, `LiteLLM model ${id}`);
    if (entries.has(ref)) {
      throw new Error(`Ambiguous LiteLLM model identity: ${ref}`);
    }
    entries.set(ref, liteLLMMetadata(model));
  }
  return entries;
}

/** Full sorted common-model diffs, with prices expressed per million tokens on both sides. */
export function compareMetadata(
  bundled: BundledMetadata[],
  snapshot: unknown,
): MetadataComparison[] {
  const upstream = liteLLMEntries(snapshot, new Set(bundled.map((entry) => entry.ref)));
  return bundled
    .filter((entry) => upstream.has(entry.ref))
    .toSorted((a, b) => lexicalCompare(a.ref, b.ref))
    .map((entry) => {
      const native = serialized(entry.metadata);
      const external = serialized(upstream.get(entry.ref));
      return {
        bundled: entry,
        identical: native === external,
        diff:
          native === external
            ? ""
            : createTwoFilesPatch(
                `${entry.ref} (Branch, prices/million tokens)`,
                `${entry.ref} (LiteLLM, prices/million tokens)`,
                native,
                external,
                "",
                "",
                { context: Number.MAX_SAFE_INTEGER },
              ),
      };
    });
}

/** Re-reads the manifest before editing so earlier removals and unrelated edits are retained. */
export function removeBundledMetadata(entry: BundledMetadata): void {
  const manifest = record(JSON.parse(fs.readFileSync(entry.manifestPath, "utf8")), "Manifest");
  const catalog = record(manifest.modelCatalog, "modelCatalog");
  const providers = record(catalog.providers, "modelCatalog.providers");
  const provider = record(providers[entry.provider], entry.provider);
  const models = providerModels(provider, entry.provider);
  const matches = models.filter((model) => model.id === entry.id);
  if (matches.length !== 1) {
    throw new Error(`Expected one bundled entry for ${entry.ref}, found ${matches.length}`);
  }
  if (
    serialized(Object.fromEntries(Object.entries(matches[0]!).filter(([key]) => key !== "id"))) !==
    serialized(entry.metadata)
  ) {
    throw new Error(`Bundled metadata changed since comparison: ${entry.ref}`);
  }
  provider.models = models.filter((model) => model.id !== entry.id);
  fs.writeFileSync(entry.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function dedupeMetadata(options: {
  rootDir: string;
  snapshotPath: string;
  answer: (prompt: string) => Promise<string>;
  output: (text: string) => void;
}): Promise<{ compared: number; removed: number; errors: number }> {
  const snapshot: unknown = JSON.parse(fs.readFileSync(options.snapshotPath, "utf8"));
  const comparisons = compareMetadata(readBundledMetadata(options.rootDir), snapshot);
  let removed = 0;
  let errors = 0;
  if (!comparisons.length) {
    options.output("No common model metadata found.");
  }
  for (const comparison of comparisons) {
    const { ref, manifestPath } = comparison.bundled;
    if (comparison.identical) {
      options.output(`${ref}: canonical metadata is identical; skipping removal.`);
      continue;
    }
    options.output(comparison.diff);
    if (
      (await options.answer(`Remove '${ref}' from ${manifestPath}? (y/N): `))
        .trim()
        .toLowerCase() !== "y"
    ) {
      continue;
    }
    try {
      removeBundledMetadata(comparison.bundled);
      removed++;
      options.output(`Removed ${ref}.`);
    } catch (error) {
      errors++;
      options.output(`Could not remove ${ref}: ${String(error)}`);
    }
  }
  options.output(`Compared ${comparisons.length} common models; removed ${removed} entries.`);
  return { compared: comparisons.length, removed, errors };
}
