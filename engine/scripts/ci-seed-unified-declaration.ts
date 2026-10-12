import { TSDOWN_NON_SDK_DTS_CONFIG_GROUPS } from "./lib/tsdown-config-groups.mts";
import { writeTsdownDeclarations } from "./lib/tsdown-declaration-writer.mts";
import { listReplaceableTsdownDeclarationOutputs } from "./tsdown-build.mts";

const group = process.argv[2];
if (!group || !TSDOWN_NON_SDK_DTS_CONFIG_GROUPS.some((candidate) => candidate === group)) {
  throw new Error(`Unknown unified declaration group: ${group ?? "(missing)"}`);
}

await writeTsdownDeclarations(
  [group],
  "tsdown-unified",
  (root) => listReplaceableTsdownDeclarationOutputs({ cwd: root, roots: ["dist"] }),
  "scripts/write-unified-entry-dts.ts",
);
