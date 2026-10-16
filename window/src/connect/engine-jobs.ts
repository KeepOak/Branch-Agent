// Jobs the engine declares for itself. They run without anyone asking: the hourly check-in (a heartbeat monitor), the
// overnight memory cleanup and the skill collection review. They are not the person's automations, so Automations and
// Coming up leave them out. Their controls live where the preview puts them (the check-in under Automations › Check-ins,
// the cleanup and review under Settings › Seasons). The jobs themselves are never deleted.

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The engine's skill review job is named skill-collection-review-<agent id> (src/cron/skill-collection-review-monitor.ts). */
const SKILL_REVIEW_NAME = /^skill-collection-review-/;
/** The overnight memory cleanup's job names, current and before the doctor migrates them (engine/src/memory-host-sdk/rings.ts). */
const MEMORY_CLEANUP_NAMES = new Set(["Memory Rings Promotion", "Memory Light Rings", "Memory REM Rings"]);
/** The memory-core tag the engine writes into a managed job's description or tags. */
const MEMORY_CLEANUP_TAG = /\[managed-by=memory-core\./;

/** True for a job the engine declared for itself, which the person did not set up. */
export function isEngineJob(job: unknown): boolean {
  const j = rec(job);
  if (rec(j.payload).kind === "heartbeat") return true;
  const name = str(j.name);
  if (SKILL_REVIEW_NAME.test(name) || MEMORY_CLEANUP_NAMES.has(name)) return true;
  return MEMORY_CLEANUP_TAG.test(`${str(j.description)} ${str(j.tags)}`);
}
