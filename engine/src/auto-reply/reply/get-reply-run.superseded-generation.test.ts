// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "../../agents/prepared-model-runtime.test-harness.js";
import { describe, expect, it, vi } from "vitest";
import { getPreparedModelRuntimePluginGeneration } from "../../agents/prepared-model-runtime-generation-scope.js";
import {
  loadPublishedGatewayReplyDispatchRuntime,
  refreshPreparedModelRuntimeSnapshots,
} from "../../agents/prepared-model-runtime.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { runPreparedReply } from "./get-reply-run.js";
import { bindPreparedReplyDispatchRuntime } from "./prepared-reply-dispatch-context.js";

const reply = vi.hoisted(() => ({
  prepareContext: vi.fn(),
  prepareAdmission: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("./get-reply-run-context.js", () => ({ prepareReplyRunContext: reply.prepareContext }));
vi.mock("./get-reply-run-admission.js", () => ({
  prepareReplyRunAdmission: reply.prepareAdmission,
}));
vi.mock("./get-reply-run-execute.js", () => ({ executePreparedReplyRun: reply.execute }));

const fixture = usePreparedModelRuntimeHarness({ label: "reply-superseded-generation" });
const { mocks } = fixture;

const trunks = ["ash", "birch", "cedar"] as const;
const config: BranchConfig = {
  agents: {
    defaults: { model: "openai/gpt-5" },
    entries: Object.fromEntries(trunks.map((id) => [id, {}])),
  },
  auth: { order: { openai: ["openai:default"] } },
};
const publicationOptions = {
  allowGatewaySubagentBinding: true,
  catalogMode: "static" as const,
  gatewayLifecycle: true,
};

describe("replies admitted just before another Trunk's preparation publishes", () => {
  it("run every Trunk's reply on the successor generation instead of failing", async () => {
    mocks.configuredAgentIds = [...trunks];
    await refreshPreparedModelRuntimeSnapshots(config, publicationOptions);
    // Each Trunk's message is admitted under the generation published at that moment.
    const admitted = await Promise.all(
      trunks.map(async (agentId) => {
        const runtime = await loadPublishedGatewayReplyDispatchRuntime({ agentId });
        expect(runtime?.pluginGeneration).toBeDefined();
        return runtime!;
      }),
    );
    // A sibling Trunk's startup preparation republishes every owner before the replies start.
    const next = structuredClone(config);
    next.auth!.order!.openai = ["openai:work"];
    await refreshPreparedModelRuntimeSnapshots(next, publicationOptions);

    const ranUnder: unknown[] = [];
    reply.prepareContext.mockImplementation(async () => ({
      kind: "ready",
      params: { cfg: config, provider: "openai", model: "gpt-5" },
      thinkingRuntime: "branch",
      workspaceDir: undefined,
    }));
    reply.prepareAdmission.mockResolvedValue({ kind: "ready" });
    reply.execute.mockImplementation(async () => {
      ranUnder.push(getPreparedModelRuntimePluginGeneration());
      return { text: "done" };
    });

    const results = await Promise.all(
      admitted.map((runtime) =>
        bindPreparedReplyDispatchRuntime(runtime, async () =>
          runPreparedReply({ provider: "openai", model: "gpt-5" } as never),
        )(),
      ),
    );

    expect(results).toEqual(trunks.map(() => ({ text: "done" })));
    expect(reply.execute).toHaveBeenCalledTimes(trunks.length);
    for (const agentId of trunks) {
      const current = await loadPublishedGatewayReplyDispatchRuntime({ agentId });
      expect(ranUnder).toContain(current?.pluginGeneration);
    }
    for (const runtime of admitted) {
      expect(ranUnder).not.toContain(runtime.pluginGeneration);
    }
  });
});
