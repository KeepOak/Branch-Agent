import { isRecord, normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";
import { MANAGED_RINGS_DECLARATION_KEY } from "../rings-cron-contract.js";

type RingsCronIdentifiers = Pick<
  typeof import("branch/plugin-sdk/memory-core-host-status"),
  | "MANAGED_MEMORY_RINGS_CRON_NAME"
  | "MANAGED_MEMORY_RINGS_CRON_TAG"
  | "MEMORY_RINGS_SYSTEM_EVENT_TEXT"
  | "LEGACY_MEMORY_LIGHT_RINGS_CRON_NAME"
  | "LEGACY_MEMORY_LIGHT_RINGS_CRON_TAG"
  | "LEGACY_MEMORY_LIGHT_RINGS_EVENT_TEXT"
  | "LEGACY_MEMORY_REM_RINGS_CRON_NAME"
  | "LEGACY_MEMORY_REM_RINGS_CRON_TAG"
  | "LEGACY_MEMORY_REM_RINGS_EVENT_TEXT"
>;

export type RingsCronKind = "declared" | "legacy" | "phase" | "ambiguous";

/** Doctor owns historical recognition; runtime may use the result only for diagnosis. */
export function classifyRingsCronJob(
  raw: Record<string, unknown>,
  constants: RingsCronIdentifiers,
): RingsCronKind | undefined {
  if (raw.declarationKey === MANAGED_RINGS_DECLARATION_KEY) {
    return "declared";
  }
  if (raw.declarationKey !== undefined && raw.declarationKey !== null) {
    return undefined;
  }
  const name = normalizeOptionalString(raw.name);
  const description = normalizeOptionalString(raw.description);
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const kind = normalizeOptionalString(payload.kind)?.toLowerCase();
  const token = normalizeOptionalString(
    kind === "systemevent" ? payload.text : kind === "agentturn" ? payload.message : undefined,
  );
  let phase: "phase" | undefined;
  for (const [phaseName, tag, event] of [
    [
      constants.LEGACY_MEMORY_LIGHT_RINGS_CRON_NAME,
      constants.LEGACY_MEMORY_LIGHT_RINGS_CRON_TAG,
      constants.LEGACY_MEMORY_LIGHT_RINGS_EVENT_TEXT,
    ],
    [
      constants.LEGACY_MEMORY_REM_RINGS_CRON_NAME,
      constants.LEGACY_MEMORY_REM_RINGS_CRON_TAG,
      constants.LEGACY_MEMORY_REM_RINGS_EVENT_TEXT,
    ],
  ] as const) {
    if (description?.includes(tag)) {
      // A retained phase tag cannot authorize replacing an operator-authored prompt.
      if (token !== event && token !== constants.MEMORY_RINGS_SYSTEM_EVENT_TEXT) {
        return "ambiguous";
      }
      phase = "phase";
    }
    if (name === phaseName && kind === "systemevent" && token === event) {
      phase = "phase";
    }
  }
  if (description?.includes(constants.MANAGED_MEMORY_RINGS_CRON_TAG)) {
    if (token === constants.MEMORY_RINGS_SYSTEM_EVENT_TEXT) {
      return "legacy";
    }
    return phase ?? "ambiguous";
  }
  if (
    name === constants.MANAGED_MEMORY_RINGS_CRON_NAME &&
    token === constants.MEMORY_RINGS_SYSTEM_EVENT_TEXT
  ) {
    return "legacy";
  }
  return phase;
}
