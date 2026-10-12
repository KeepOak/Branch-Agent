import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export function resolveZalouserDmSessionScope(config: BranchConfig) {
  const configured = config.session?.dmScope;
  return configured === "main" || !configured ? "per-channel-peer" : configured;
}
