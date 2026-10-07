import type { PluginCompatRecord } from "./types.js";

export const AGENT_LIST_RUNTIME_PROJECTION_COMPAT_RECORDS = [
  {
    code: "agent-list-runtime-projection",
    status: "deprecated",
    owner: "sdk",
    introduced: "2026-07-27",
    deprecated: "2026-10-02",
    warningStarts: "2026-10-02",
    removeAfter: "2027-01-02",
    replacement:
      "Canonical `cfg.agents.entries`, or `listAgentIds` / `resolveAgentConfig` from `branch/plugin-sdk/agent-runtime`",
    docsPath: "/plugins/sdk-migration/how-to-migrate#agent-roster-config",
    surfaces: ["non-enumerable runtime BranchConfig.agents.list projection"],
    diagnostics: ["plugin compatibility registry and migration documentation; no runtime warnings"],
    tests: ["src/config/runtime-overrides.test.ts", "src/plugins/compat/registry.test.ts"],
    releaseNote:
      "The runtime agents.list projection introduced in #113146 remains untyped compatibility for plugins built against stable SDK releases through 2026.9.x; authored configs use agents.entries without default markers.",
  },
] as const satisfies readonly PluginCompatRecord[];
