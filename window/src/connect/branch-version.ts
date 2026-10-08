import { useEffect, useState } from "react";
import { useDesktopComponentStatus } from "./desktop-component-updates";

const BRANCH_VERSION = /^\d+\.\d+\.\d+(?:-build-[a-zA-Z0-9]+)?$/;
const BRANCH_RELEASE = /^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-build-([a-zA-Z0-9]+))?$/;
/** Preview T0 (`versionT5`): tip on the status-bar version. */
export const BRANCH_VERSION_TIP = "Branch’s own version. Updates apply in place.";

/** The shipped window stamp is written by the component release, not by the engine. */
export function useShippedWindowVersion(): string {
  const [windowVersion, setWindowVersion] = useState("");
  useEffect(() => {
    let live = true;
    void fetch("/branch-build.txt", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const value = (await response.text()).trim();
      if (live && BRANCH_VERSION.test(value)) setWindowVersion(value);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return windowVersion;
}

/** Prefer a component version that already carries a build id; otherwise the shipped window stamp. */
export function runningBranchVersion(componentVersion: string | null | undefined, windowVersion = ""): string {
  const component = componentVersion?.trim() ?? "";
  const stamp = windowVersion.trim();
  if (component.includes("-build-")) return component;
  if (stamp.includes("-build-")) return stamp;
  return component || stamp;
}

export function useBranchVersion(gatewayUrl?: string): string {
  const desktop = useDesktopComponentStatus(gatewayUrl);
  const windowVersion = useShippedWindowVersion();
  return desktop.status?.currentVersion ?? windowVersion;
}

export function branchVersionLabel(version: string): string {
  return `Branch ${version.split("-build-")[0]}`;
}

export function branchVersionDetail(version: string): string {
  const [number, build] = version.split("-build-");
  return build ? `${number} · build ${build.slice(0, 8)}` : number;
}

export function versionParts(version: string): { short: string; detail: string } {
  const short = version.split("-build-")[0];
  return { short, detail: branchVersionDetail(version) };
}

function parseRelease(version: string): { major: number; minor: number; patch: number; build: string } | null {
  const match = BRANCH_RELEASE.exec(version.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0), build: match[4] ?? "" };
}

function buildKey(version: string): string {
  const parsed = parseRelease(version);
  if (parsed?.build) return parsed.build.toLowerCase();
  const trimmed = version.trim().toLowerCase();
  return /^[a-z0-9]{7,40}$/.test(trimmed) ? trimmed : "";
}

function sameBuild(left: string, right: string): boolean {
  return Boolean(left && right && (left === right || left.startsWith(right) || right.startsWith(left)));
}

/** True when `candidate` is a real Branch release newer than `current` (leftover older staged shells are not). */
export function isNewerBranchVersion(candidate: string | null | undefined, current: string | null | undefined): boolean {
  const next = candidate?.trim() ?? "";
  const have = current?.trim() ?? "";
  if (!next || next === have) return false;
  if (sameBuild(buildKey(next), buildKey(have))) return false;
  const parsedNext = parseRelease(next);
  const parsedHave = parseRelease(have);
  if (parsedNext && parsedHave) {
    if (parsedNext.major !== parsedHave.major) return parsedNext.major > parsedHave.major;
    if (parsedNext.minor !== parsedHave.minor) return parsedNext.minor > parsedHave.minor;
    if (parsedNext.patch !== parsedHave.patch) return parsedNext.patch > parsedHave.patch;
    return Boolean(parsedNext.build && parsedHave.build && parsedNext.build !== parsedHave.build);
  }
  return Boolean(parsedNext && !parsedHave);
}
