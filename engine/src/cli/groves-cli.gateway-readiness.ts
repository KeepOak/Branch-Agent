import type { BranchConfig } from "../config/types.branch.js";
import { sleep } from "../utils/sleep.js";
import { callGatewayFromCli } from "./gateway-rpc.js";

const GROVE_AGENT_RELOAD_TIMEOUT_MS = 15_000;
const GROVE_AGENT_RELOAD_POLL_MS = 100;

export async function waitUntilGatewayAgentAvailable(agentId: string): Promise<void> {
  const deadline = Date.now() + GROVE_AGENT_RELOAD_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = (await callGatewayFromCli("config.get", { timeout: "5000" }, {})) as {
        config?: BranchConfig;
        configRevisionHash?: unknown;
        appliedConfigHash?: unknown;
      };
      // Matching tokens can describe a cached roster from before this agent was added.
      if (
        Object.hasOwn(response.config?.agents?.entries ?? {}, agentId) &&
        typeof response.configRevisionHash === "string" &&
        response.configRevisionHash === response.appliedConfigHash
      ) {
        return;
      }
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await sleep(GROVE_AGENT_RELOAD_POLL_MS);
  }
  const suffix = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`Gateway did not apply the Grove agent configuration in time${suffix}`);
}
