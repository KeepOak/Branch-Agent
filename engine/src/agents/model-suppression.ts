/**
 * Built-in model suppression helpers.
 * Resolves prepared plugin manifest suppression rules so
 * built-in catalog entries can be hidden or blocked consistently.
 */
import type { BranchConfig } from "../config/types.branch.js";
import { buildManifestBuiltInModelSuppressionResolver } from "../plugins/manifest-model-suppression.js";
import type { PluginMetadataSnapshot } from "../plugins/plugin-metadata-snapshot.types.js";

/** Resolves one provider-owned rule against the caller's concrete model route. */
export function resolveBuiltInModelSuppressionFromManifest(params: {
  provider?: string | null;
  id?: string | null;
  baseUrl?: string | null;
  config?: BranchConfig;
  unconditionalOnly?: boolean;
  workspaceDir?: string;
  metadataSnapshot?: PluginMetadataSnapshot;
}) {
  return buildManifestBuiltInModelSuppressionResolver({
    env: process.env,
    config: params.config,
    workspaceDir: params.workspaceDir,
    metadataSnapshot: params.metadataSnapshot,
  })(params);
}

/**
 * Return true only for unconditional manifest suppressions.
 * Inline model entries may override conditional suppressions, but not absolute
 * provider capability blocks.
 */
export function shouldUnconditionallySuppress(params: {
  provider?: string | null;
  id?: string | null;
  config?: BranchConfig;
  workspaceDir?: string;
}): boolean {
  return (
    resolveBuiltInModelSuppressionFromManifest({ ...params, unconditionalOnly: true })?.suppress ??
    false
  );
}

/** Resolve the user-facing suppression error message for a built-in model. */
export function buildSuppressedBuiltInModelError(params: {
  provider?: string | null;
  id?: string | null;
  baseUrl?: string | null;
  config?: BranchConfig;
  workspaceDir?: string;
}): string | undefined {
  return resolveBuiltInModelSuppressionFromManifest(params)?.errorMessage;
}

/** Build a reusable suppression predicate for repeated catalog filtering. */
export function buildShouldSuppressBuiltInModelCore(params: {
  config?: BranchConfig;
  workspaceDir?: string;
}): (input: { provider?: string | null; id?: string | null; baseUrl?: string | null }) => boolean {
  const resolver = buildManifestBuiltInModelSuppressionResolver({
    env: process.env,
    ...params,
  });
  return (input) => resolver(input)?.suppress ?? false;
}
