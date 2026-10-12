import { TSDOWN_NON_SDK_DTS_CONFIG_GROUPS } from "./lib/tsdown-config-groups.mts";
import { writeTsdownDeclarations } from "./lib/tsdown-declaration-writer.mts";
import { listReplaceableTsdownDeclarationOutputs } from "./tsdown-build.mts";
import { restoreCiUnifiedDeclarations } from "./ci-restore-unified-declarations.mts";

if (process.env.BRANCH_CI_PREBUILT_UNIFIED_DTS === "1") {
  restoreCiUnifiedDeclarations();
} else {
  await writeTsdownDeclarations(
    TSDOWN_NON_SDK_DTS_CONFIG_GROUPS,
    "tsdown-unified",
    (root) => listReplaceableTsdownDeclarationOutputs({ cwd: root, roots: ["dist"] }),
    "scripts/write-unified-entry-dts.ts",
  );
}
