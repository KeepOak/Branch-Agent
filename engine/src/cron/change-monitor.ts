import { createHash } from "node:crypto";

/** Canonical observations make object key order irrelevant without storing probe content.
 * Adapted to the existing script-trigger ledger from Hermes cron/monitor.py's
 * probe/fingerprint/change-decision pattern (AUTOMATION-0028).
 */
function canonicalObservation(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || ancestors.has(value)) {
    throw new Error("monitor observation must be finite, acyclic JSON");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${Array.from(value, (item) => canonicalObservation(item, ancestors)).join(",")}]`;
    }
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new Error("monitor observation must use plain JSON objects");
    }
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalObservation((value as Record<string, unknown>)[key], ancestors)}`,
      )
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function buildChangeMonitorDecision(options: {
  observe: unknown;
  previousState?: unknown;
  notifyOnFirst?: boolean;
  data?: unknown;
}) {
  const fingerprint = createHash("sha256")
    .update(canonicalObservation(options.observe))
    .digest("hex");
  const previous = options.previousState;
  const marker =
    previous && typeof previous === "object" && "changeMonitor" in previous
      ? previous.changeMonitor
      : undefined;
  const previousFingerprint =
    marker &&
    typeof marker === "object" &&
    "schemaVersion" in marker &&
    marker.schemaVersion === 1 &&
    "fingerprint" in marker &&
    typeof marker.fingerprint === "string" &&
    /^[a-f0-9]{64}$/u.test(marker.fingerprint)
      ? marker.fingerprint
      : undefined;
  const data =
    options.data !== undefined
      ? options.data
      : previousFingerprint && previous && typeof previous === "object" && "data" in previous
        ? previous.data
        : undefined;
  return {
    fire:
      previousFingerprint === undefined
        ? options.notifyOnFirst === true
        : fingerprint !== previousFingerprint,
    state: {
      changeMonitor: { schemaVersion: 1, fingerprint },
      ...(data !== undefined ? { data } : {}),
    },
  };
}
