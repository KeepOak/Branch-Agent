import type { z } from "zod";
import type { AgentDefaultsConfig } from "./types.agent-defaults.js";
import type { AgentSandboxConfig } from "./types.agents-shared.js";
import type { MemorySearchConfig } from "./types.memory.js";
import type { AgentToolsConfig } from "./types.tools.js";
import type { TtsConfig } from "./types.tts.js";
import type { AgentEntrySchema } from "./zod-schema.agent-runtime.js";
import type { BindingsSchema } from "./zod-schema.agents.js";
type SchemaAgentBinding = NonNullable<z.input<typeof BindingsSchema>>[number];

export type AgentBindingMatch = AgentRouteBinding["match"];

export type AgentRouteBinding = Extract<SchemaAgentBinding, { type?: "route" }>;

export type AgentAcpBinding = Extract<SchemaAgentBinding, { type: "acp" }>;

export type AgentBinding = AgentRouteBinding | AgentAcpBinding;

export type AgentConfig = Omit<
  z.input<typeof AgentEntrySchema>,
  "memory" | "tts" | "sandbox" | "tools"
> & {
  memory?: {
    search?: MemorySearchConfig;
  };
  tts?: TtsConfig & { prefsPath?: string };
  /** Optional per-agent sandbox overrides. */
  sandbox?: AgentSandboxConfig;
  tools?: AgentToolsConfig;
};

export type AgentEntryConfig = Omit<AgentConfig, "id">;

/** Shared Trunk job queue: whether idle Trunks take queued jobs, and which Trunks may. */
/** Opt-in PR signal wakes: `owner/name` repositories this gateway polls for Trunk-authored PRs. */
export type SignalWakesConfig = {
  repos?: string[];
};

export type TrunkQueueConfig = {
  /** Idle Trunks take queued jobs unless this is false. */
  enabled?: boolean;
  /** Trunk ids allowed to take queued jobs. Unset means every builder-* Trunk. */
  agents?: string[];
};

/** Shared durable memory between Trunks: team memory search reads only these agents. */
export type TeamMemoryConfig = {
  /** Trunk ids that share durable notes with each other. Opt-in: unset means no Trunk shares. Linked outside Branches are never included. */
  agents?: string[];
};

export type AgentsConfig = {
  ownership?: "explicit";
  /** Contact Trunk used by unrouted conversations; explicit bindings take precedence. */
  defaultId?: string;
  characterAssignmentVersion?: 1;
  defaults?: AgentDefaultsConfig;
  entries?: Record<string, AgentEntryConfig>;
  trunkQueue?: TrunkQueueConfig;
  signalWakes?: SignalWakesConfig;
  teamMemory?: TeamMemoryConfig;
};
