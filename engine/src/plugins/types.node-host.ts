// Node-host plugin command contracts, including the opt-in duplex transport.
import type { BranchConfig } from "../config/types.branch.js";

export type BranchPluginNodeHostCommandAvailabilityContext = {
  /** Node-local configuration used to build this host's Gateway declaration. */
  config: BranchConfig;
  /** Node-host process environment. */
  env: NodeJS.ProcessEnv;
};

export type BranchPluginNodeHostCommandIo = {
  emitChunk(chunk: string): Promise<void>;
  onInput(callback: (payloadJSON: string) => void): void;
  /** Complete binary messages; available when the node host dispatches a duplex command. */
  frames?: {
    send(message: Uint8Array): Promise<void>;
    onMessage(listener: (message: Uint8Array) => void | Promise<void>): () => void;
  };
  signal: AbortSignal;
};

export type BranchPluginNodeWorkspace = {
  workspaceDir: string;
  environmentId: string;
  sessionId: string;
  ownerEpoch: number;
  sessionKey: string;
};

export type BranchPluginNodeHostCommandContext = {
  /** Emit one node-owned event through the active Gateway connection. */
  sendNodeEvent(event: string, payload: unknown): Promise<unknown>;
  /** Agent session that owns this invocation, when the caller supplied one. */
  sessionKey?: string;
  /** Aborts when the Gateway cancels this specific node-host invocation. */
  signal?: AbortSignal;
  /** Prepare local exec policy; call the returned guard synchronously immediately before spawn. */
  prepareExecAuthorization?: (source: "human-approved" | "session-full") => () => void;
  /** @deprecated Use acquireManagedWorkspaceAsync; retained for synchronous plugin compatibility. */
  acquireManagedWorkspace?: (request: BranchPluginNodeWorkspace) => {
    workspaceDir: string;
    /** Stable HOME owned and validated by this exact prepared workspace binding. */
    homeDir?: string;
    release: () => void;
  };
  /** Protect an exact node-owned workspace after durable worker-backed binding validation. */
  acquireManagedWorkspaceAsync?: (request: BranchPluginNodeWorkspace) => Promise<{
    workspaceDir: string;
    homeDir?: string;
    release: () => void;
  }>;
};

type BranchPluginNodeHostCommandBase = {
  command: string;
  cap?: string;
  dangerous?: boolean;
  /** Settle node-local startup before the initial capability declaration; registration stays synchronous. */
  prepare?: (context: BranchPluginNodeHostCommandAvailabilityContext) => Promise<void> | void;
  /** Return false to omit this command and capability from the node declaration. */
  isAvailable?: (context: BranchPluginNodeHostCommandAvailabilityContext) => boolean;
  /** Watch availability; node shutdown awaits the returned cleanup callback. */
  watchAvailability?: (
    context: BranchPluginNodeHostCommandAvailabilityContext,
    onChange: () => void,
  ) => (() => void | Promise<void>) | void;
  /** Release command-owned state when the active Gateway connection closes. */
  onDisconnect?: () => Promise<void> | void;
  /** Return false only when retained work and cleanup are idle; an absent hook defers auto-update. */
  hasActiveWork?: () => boolean;
  /** Optional Computer Use declaration published with this command's node manifest. */
  computerUse?: (context: BranchPluginNodeHostCommandAvailabilityContext) => unknown;
  agentTool?: {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    /** Platforms where this tool is allowlisted by default; omit for explicit config only. */
    defaultPlatforms?: Array<"ios" | "android" | "macos" | "windows" | "linux" | "unknown">;
    mcp?: { server: string; tool: string };
  };
};

export type BranchPluginNodeHostCommand = BranchPluginNodeHostCommandBase & {
  // Not a discriminated handle signature: a union of different arities makes
  // plain `command.handle(params)` uncallable for consumers holding the union.
  // true requires IO; optional commands also retain their unary invocation.
  duplex?: boolean | "optional";
  handle: (
    paramsJSON?: string | null,
    io?: BranchPluginNodeHostCommandIo,
    context?: BranchPluginNodeHostCommandContext,
  ) => Promise<string>;
};
