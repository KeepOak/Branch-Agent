import type { CanopyChange } from "@branch/canopy-contract";
import { isRecord } from "branch/plugin-sdk/string-coerce-runtime";

export function normalizeCanopyChange(payload: unknown): CanopyChange | null {
  if (!isRecord(payload)) {
    return null;
  }
  const { epoch, revision, cardsRevision } = payload;
  const keys = Object.keys(payload);
  return keys.every((key) => key === "epoch" || key === "revision" || key === "cardsRevision") &&
    (cardsRevision === undefined ||
      (typeof cardsRevision === "number" &&
        Number.isSafeInteger(cardsRevision) &&
        cardsRevision > 0)) &&
    typeof epoch === "string" &&
    epoch.length > 0 &&
    epoch.length <= 128 &&
    typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision > 0
    ? { epoch, revision, cardsRevision }
    : null;
}
