import { useEffect, useState } from "react";
import { componentDesktop, useDesktopComponentStatus } from "./desktop-component-updates";

export function versionParts(version: string): { short: string; detail: string } {
  const match = /^v?(\d+\.\d+\.\d+)(?:-build-([a-f\d]+))?/i.exec(version.trim());
  return { short: match?.[1] ?? version.trim(), detail: match?.[2] ? `${match[1]} · build ${match[2].slice(0, 8)}` : version.trim() };
}

/** The desktop component is authoritative; a browser window reads the stamp shipped beside its own assets. */
export function useBranchVersion(gatewayUrl?: string): string {
  const native = useDesktopComponentStatus(gatewayUrl);
  const [stamp, setStamp] = useState("");
  useEffect(() => {
    if (typeof fetch !== "function") return;
    let live = true;
    void fetch(`${import.meta.env.BASE_URL}branch-build.txt`).then((response) => response.ok ? response.text() : "").then(
      (value) => { if (live) setStamp(value.trim()); },
      () => undefined,
    );
    return () => { live = false; };
  }, []);
  return componentDesktop(gatewayUrl) ? native.status?.currentVersion ?? stamp : stamp;
}
