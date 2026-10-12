import { createDeferred } from "branch/plugin-sdk/extension-shared";
import type { BranchPluginNodeHostCommandIo } from "branch/plugin-sdk/node-host";
import type {
  BranchPluginApi,
  BranchPluginServiceContext,
} from "branch/plugin-sdk/plugin-entry";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { handleFileCreate } from "./node-host/file-create.js";
import { handleFileFetch } from "./node-host/file-fetch.js";
import { createWorkspaceCommand } from "./node-host/workspace-memory.js";
import { createFileTransferNodeInvokePolicy } from "./shared/node-invoke-policy.js";
import { createCtx } from "./shared/node-invoke-policy.test-support.js";
import { createWorkspaceWorkerPolicy } from "./shared/workspace-memory-policy.js";

/** Real policy and file handlers; only the paired connection is replaced here. */
export function createNodeWorkspaceTestTransport(
  api: BranchPluginApi,
  remote: string,
  afterChunk?: () => void,
  onOutput?: (bytes: Uint8Array) => void,
): NonNullable<BranchPluginServiceContext["openNodeDuplex"]> {
  return async (request) => {
    const controller = new AbortController();
    const signal = request.signal
      ? AbortSignal.any([controller.signal, request.signal])
      : controller.signal;
    const ready = createDeferred<void>();
    let receive: ((message: Uint8Array) => void | Promise<void>) | undefined;
    let acknowledge: ((message: Uint8Array) => void | Promise<void>) | undefined;
    const io: BranchPluginNodeHostCommandIo = {
      signal,
      emitChunk: async () => {},
      onInput: () => {},
      frames: {
        onMessage: (listener) => {
          receive = listener;
          ready.resolve();
          return () => {
            receive = undefined;
          };
        },
        send: async (message) => {
          onOutput?.(message);
          await acknowledge?.(message);
        },
      },
    };
    const { ctx, invokeNode } = createCtx({
      command: request.command,
      params: request.params as Record<string, unknown>,
      pluginConfig: api.config.plugins!.entries!["file-transfer"]!.config,
    });
    invokeNode.mockImplementation(async ({ params } = {}) => {
      request.assertCurrent?.();
      signal.throwIfAborted();
      if (request.command === "workspace.memory" || request.command === "workspace.skills") {
        const nodeApi = createTestPluginApi({
          config: { agents: { defaults: { workspace: remote } } },
          runtime: {
            agent: { resolveAgentWorkspaceDir: () => remote },
          } as unknown as BranchPluginApi["runtime"],
        });
        return {
          ok: true,
          payload: JSON.parse(
            await createWorkspaceCommand(
              nodeApi,
              request.command === "workspace.memory" ? "memory" : "skills",
            ).handle(JSON.stringify(params ?? request.params), io),
          ),
        };
      }
      return {
        ok: true,
        payload:
          request.command === "file.fetch"
            ? await handleFileFetch(params as Record<string, unknown>, io)
            : await handleFileCreate(params as Record<string, unknown>, io),
      };
    });
    const policy =
      request.command === "workspace.memory"
        ? createWorkspaceWorkerPolicy("memory")
        : request.command === "workspace.skills"
          ? createWorkspaceWorkerPolicy("skills")
          : createFileTransferNodeInvokePolicy();
    const closed = Promise.resolve(policy.handle(ctx)).then((result) => {
      if (!result.ok) {
        throw new Error(`${result.code}: ${result.message}`);
      }
      return result;
    });
    await Promise.race([
      ready.promise,
      closed.then(() => {
        throw new Error("closed before upload ready");
      }),
    ]);
    return {
      send: async (message) => {
        request.assertCurrent?.();
        signal.throwIfAborted();
        if (!receive) {
          throw new Error("input receiver missing");
        }
        await receive(message);
        if (message.byteLength) {
          afterChunk?.();
        }
      },
      onMessage: (listener) => {
        acknowledge = listener;
        return () => {
          acknowledge = undefined;
        };
      },
      close: () => controller.abort(new Error("test connection closed")),
      closed,
    };
  };
}
