// From openclaw/openclaw@3d23bf9dd463f6cec1928cc65a7297c885a4529e:ui/config/control-ui-locales.ts (atlas OBSERVABILITY-0102). Changed for Branch: materialize the real locale catalog for named Harvest tests without a Vite virtual-module plugin.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadControlUiTranslationMemory,
  materializeControlUiLocaleCatalog,
} from "../../../../scripts/lib/control-ui-i18n-catalog-values.ts";
import { loadControlUiSourceCatalog } from "../../../../scripts/lib/control-ui-i18n-catalog.ts";
import { flattenTranslations } from "../../../../scripts/lib/control-ui-i18n-sync-plan.ts";

export function loadDebugTestLocale() {
  const memoryPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../i18n/.i18n/zh-CN.tm.jsonl",
  );
  const source = loadControlUiSourceCatalog();
  const memory = loadControlUiTranslationMemory(memoryPath);
  if (existsSync(memoryPath) && memory.size === 0) {
    throw new Error("Control UI zh-CN translation memory is missing or empty");
  }
  const catalog = existsSync(memoryPath)
    ? materializeControlUiLocaleCatalog(flattenTranslations(source), memory)
    : source;
  const { configHints, ...base } = catalog;
  return { ...base, ...(typeof configHints === "object" ? configHints : {}) };
}
