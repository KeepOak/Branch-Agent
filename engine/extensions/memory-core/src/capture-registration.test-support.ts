// Test support: register the memory capture features on a test plugin API and
// expose the captured tool factories and hooks, so tests drive the real callers.
import type { BranchConfig } from "branch/plugin-sdk/memory-core-host-runtime-core";
import type {
  AnyAgentTool,
  BranchPluginApi,
  BranchPluginToolContext,
} from "branch/plugin-sdk/plugin-entry";
import type {
  OpenKeyedStoreOptions,
  PluginStateKeyedStore,
} from "branch/plugin-sdk/plugin-state-runtime";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { vi } from "vitest";
import { registerMemoryCaptureFeatures } from "./capture-registration.js";

/**
 * The CI runner uses worker threads, where the SQLite plugin-state broker is
 * unavailable; this Map-backed store keeps the keyed-store contract the tools use.
 */
function openInMemoryKeyedStore<T>(
  rows: Map<string, unknown>,
  namespace: string,
): PluginStateKeyedStore<T> {
  const key = (entryKey: string) => `${namespace}:${entryKey}`;
  return {
    async register(entryKey: string, value: T) {
      rows.set(key(entryKey), structuredClone(value));
    },
    async lookup(entryKey: string) {
      const value = rows.get(key(entryKey));
      return value === undefined ? undefined : (structuredClone(value) as T);
    },
  } as unknown as PluginStateKeyedStore<T>;
}

type HookHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

type CommandHandler = (ctx: Record<string, unknown>) => Promise<{ text?: string }>;
type GatewayHandler = (options: {
  params: unknown;
  respond: (ok: boolean, payload?: unknown, error?: unknown) => void;
}) => Promise<void>;

export type CaptureHarness = {
  tool: (name: string, ctx?: Partial<BranchPluginToolContext>) => AnyAgentTool | null;
  command: (name: string) => CommandHandler;
  gateway: (method: string, params: unknown) => Promise<{ ok: boolean; payload?: unknown; error?: unknown }>;
  hook: (name: string) => HookHandler;
  llmComplete: ReturnType<typeof vi.fn>;
  warnings: string[];
};

export function createCaptureHarness(params: {
  workspaceDir: string;
  pluginConfig?: Record<string, unknown>;
  llmText?: string | (() => Promise<string>);
  /** Shared rows so two harnesses can observe the same plugin state (a restart). */
  stateRows?: Map<string, unknown>;
}): CaptureHarness {
  const config = {
    agents: { defaults: { workspace: params.workspaceDir }, list: [{ id: "main", default: true }] },
    plugins: { entries: { "memory-core": { config: params.pluginConfig ?? {} } } },
  } as BranchConfig;
  const factories = new Map<string, (ctx: BranchPluginToolContext) => AnyAgentTool | null>();
  const hooks = new Map<string, HookHandler>();
  const commands = new Map<string, CommandHandler>();
  const gatewayMethods = new Map<string, GatewayHandler>();
  const warnings: string[] = [];
  const llmComplete = vi.fn(async () => ({
    text: typeof params.llmText === "function" ? await params.llmText() : (params.llmText ?? ""),
  }));
  const runtime = {
    config: { current: () => config },
    agent: { resolveAgentWorkspaceDir: () => params.workspaceDir },
    llm: { complete: llmComplete },
  } as unknown as BranchPluginApi["runtime"];
  const api = createTestPluginApi({
    config,
    runtime,
    logger: {
      info() {},
      debug() {},
      error() {},
      warn(message: string) {
        warnings.push(message);
      },
    },
    registerTool(factory, options) {
      for (const name of options?.names ?? []) {
        if (typeof factory === "function") {
          factories.set(name, factory as (ctx: BranchPluginToolContext) => AnyAgentTool | null);
        }
      }
    },
    on(hookName: string, handler: unknown) {
      hooks.set(hookName, handler as HookHandler);
    },
    registerCommand(command: { name: string; handler: unknown }) {
      commands.set(command.name, command.handler as CommandHandler);
    },
    registerGatewayMethod(method: string, handler: unknown) {
      gatewayMethods.set(method, handler as GatewayHandler);
    },
  } as Parameters<typeof createTestPluginApi>[0]);
  const stateRows = params.stateRows ?? new Map<string, unknown>();
  registerMemoryCaptureFeatures(api, {
    openKeyedStore: <T>(options: OpenKeyedStoreOptions) =>
      openInMemoryKeyedStore<T>(stateRows, options.namespace),
  });
  return {
    tool(name, ctx = {}) {
      const factory = factories.get(name);
      if (!factory) {
        throw new Error(`tool ${name} was not registered`);
      }
      return factory({
        agentId: "main",
        sessionKey: "agent:main:main",
        senderIsOwner: true,
        config,
        ...ctx,
      } as BranchPluginToolContext);
    },
    command(name) {
      const handler = commands.get(name);
      if (!handler) {
        throw new Error(`command ${name} was not registered`);
      }
      return handler;
    },
    async gateway(method, params) {
      const handler = gatewayMethods.get(method);
      if (!handler) {
        throw new Error(`gateway method ${method} was not registered`);
      }
      let outcome: { ok: boolean; payload?: unknown; error?: unknown } = { ok: false };
      await handler({
        params,
        respond: (ok, payload, error) => {
          outcome = { ok, payload, error };
        },
      });
      return outcome;
    },
    hook(name) {
      const handler = hooks.get(name);
      if (!handler) {
        throw new Error(`hook ${name} was not registered`);
      }
      return handler;
    },
    llmComplete,
    warnings,
  };
}

export async function runTool(tool: AnyAgentTool | null, params: Record<string, unknown>) {
  if (!tool) {
    throw new Error("expected tool");
  }
  const result = await tool.execute("call-1", params, undefined, undefined);
  return (result as { details?: unknown }).details as Record<string, unknown>;
}
