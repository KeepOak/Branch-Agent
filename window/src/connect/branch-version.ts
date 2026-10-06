import { useEffect, useState } from "react";
import { useDesktopComponentStatus } from "./desktop-component-updates";

const BRANCH_VERSION = /^\d+\.\d+\.\d+(?:-build-[a-zA-Z0-9]+)?$/;

/** The shipped window stamp is written by the component release, not by the engine. */
export function useBranchVersion(gatewayUrl?: string): string {
  const desktop = useDesktopComponentStatus(gatewayUrl);
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
