import { readStringValue } from "@branch/normalization-core/string-coerce";
import { normalizeCsvOrLooseStringList } from "@branch/normalization-core/string-normalization";
import {
  applyBranchManifestInstallCommonFields,
  parseBranchManifestInstallBase,
  resolveBranchManifestBlock,
  resolveBranchManifestInstall,
  resolveBranchManifestOs,
  resolveBranchManifestRequires,
} from "../shared/frontmatter.js";
import type {
  BranchHookMetadata,
  HookEntry,
  HookInstallSpec,
  ParsedHookFrontmatter,
} from "./types.js";

export { parseFrontmatterBlock as parseHookFrontmatter } from "../../packages/markdown-core/src/frontmatter.js";

function parseInstallSpec(input: unknown): HookInstallSpec | undefined {
  const parsed = parseBranchManifestInstallBase(input, ["bundled", "npm", "git"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec = applyBranchManifestInstallCommonFields<HookInstallSpec>(
    {
      kind: parsed.kind as HookInstallSpec["kind"],
    },
    parsed,
  );
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.repository === "string") {
    spec.repository = raw.repository;
  }

  return spec;
}

/** Resolve Branch Agent hook metadata from the manifest block in HOOK.md frontmatter. */
export function resolveHookManifestMetadata(
  frontmatter: ParsedHookFrontmatter,
): BranchHookMetadata | undefined {
  const metadataObj = resolveBranchManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  const requires = resolveBranchManifestRequires(metadataObj);
  const install = resolveBranchManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveBranchManifestOs(metadataObj);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: readStringValue(metadataObj.emoji),
    homepage: readStringValue(metadataObj.homepage),
    hookKey: readStringValue(metadataObj.hookKey),
    export: readStringValue(metadataObj.export),
    os: osRaw.length > 0 ? osRaw : undefined,
    events: normalizeCsvOrLooseStringList(metadataObj.events),
    requires,
    install: install.length > 0 ? install : undefined,
  };
}

/** Resolve the config key for a hook, honoring metadata hookKey overrides. */
export function resolveHookKey(hookName: string, entry?: Pick<HookEntry, "metadata">): string {
  return entry?.metadata?.hookKey ?? hookName;
}
