// Preserve the runtime harness setup before importing its consumers.
// oxfmt-ignore
import { usePreparedModelRuntimeHarness } from "../agents/prepared-model-runtime.test-harness.js";
import { describe, expect, it } from "vitest";
import { createDeferred } from "../../test/helpers/promise.js";
import {
  getPreparedModelRuntimeSnapshot,
  refreshPreparedModelRuntimeSnapshots,
} from "../agents/prepared-model-runtime.js";
import { publishConfiguredModelRuntimeSnapshots } from "./server-startup-model-runtime.js";

const fixture = usePreparedModelRuntimeHarness({ label: "startup-model-supersession" });
const { mocks } = fixture;

const config = { agents: { defaults: { model: "openai/gpt-5.5" } } };

function holdNextStaticCatalog() {
  const started = createDeferred();
  const release = createDeferred();
  mocks.prepareStaticCatalog.mockImplementationOnce(async () => {
    started.resolve();
    await release.promise;
    return { entries: [] };
  });
  return { started, release };
}

function readSnapshot(agentId: string) {
  return getPreparedModelRuntimeSnapshot({
    ...fixture.agentInput(agentId, config),
    workspaceDir: `/tmp/workspace-${agentId}`,
  });
}

describe("Gateway startup model publication superseded during admission (Private #1048)", () => {
  it("waits out an agent's own startup publication instead of failing the Gateway start", async () => {
    mocks.configuredAgentIds = ["main", "haggle-bot"];
    const { started, release } = holdNextStaticCatalog();
    const startup = publishConfiguredModelRuntimeSnapshots({ cfg: config, isCurrent: () => true });
    let admission: Promise<void> | undefined;
    try {
      await started.promise;
      // haggle-bot's startup admission publishes its agent while the Gateway-wide publication builds,
      // as on a host whose worker runtime opens admission before the startup sidecars.
      admission = refreshPreparedModelRuntimeSnapshots(config, {
        agentIds: new Set(["haggle-bot"]),
        catalogMode: "static",
        allowGatewaySubagentBinding: true,
      });
      release.resolve();
      await expect(startup).resolves.toBeUndefined();
      await admission;
      for (const agentId of mocks.configuredAgentIds) {
        expect(readSnapshot(agentId)?.isCurrent()).toBe(true);
      }
    } finally {
      release.resolve();
      await Promise.allSettled([startup, admission]);
    }
  });
});
