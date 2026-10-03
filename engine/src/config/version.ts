import { parse as parseSemver, type SemVer } from "semver";
import {
  compareBranchSemver,
  isBranchCorrectionSemver,
  normalizeLegacyDotBetaVersion,
} from "../infra/semver.js";

/** Parses stable, prerelease, and legacy dot-beta Branch Agent versions. */
function parseBranchVersion(raw: string | null | undefined): SemVer | null {
  if (!raw) {
    return null;
  }
  const normalized = normalizeLegacyDotBetaVersion(raw.trim());
  return parseSemver(normalized);
}

export function normalizeBranchVersionBase(raw: string | null | undefined): string | null {
  const parsed = parseBranchVersion(raw);
  if (!parsed) {
    return null;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function compareBranchVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseBranchVersion(a);
  const parsedB = parseBranchVersion(b);
  if (!parsedA || !parsedB) {
    return null;
  }
  return compareBranchSemver(parsedA, parsedB);
}

export function shouldWarnOnTouchedVersion(
  current: string | null | undefined,
  touched: string | null | undefined,
): boolean {
  const parsedCurrent = parseBranchVersion(current);
  const parsedTouched = parseBranchVersion(touched);
  if (parsedCurrent && parsedTouched && parsedCurrent.compareMain(parsedTouched) === 0) {
    if (parsedTouched.prerelease.length === 0 || isBranchCorrectionSemver(parsedTouched)) {
      return false;
    }
  }
  return parsedCurrent !== null && parsedTouched !== null
    ? compareBranchSemver(parsedCurrent, parsedTouched) < 0
    : false;
}
