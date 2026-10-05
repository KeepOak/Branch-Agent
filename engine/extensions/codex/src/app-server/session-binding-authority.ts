import { AgentHarnessSessionSupersededError } from "branch/plugin-sdk/agent-harness-runtime";
import { prepareNativeSessionGenerationAuthority } from "branch/plugin-sdk/agent-harness-session-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { CodexAppServerBindingIdentity } from "./session-binding-record.js";

/** Decides whether a run may share the durable stable-key binding owner. */
export async function resolveCodexRunSessionBindingAuthority(params: {
  identity: Extract<CodexAppServerBindingIdentity, { kind: "session" }>;
  config?: BranchConfig;
  storePath?: string;
}): Promise<Awaited<ReturnType<typeof prepareNativeSessionGenerationAuthority>>["state"]> {
  return (
    await prepareNativeSessionGenerationAuthority({
      ...params,
      target: params.identity,
      createSupersededError: createCodexSessionGenerationSupersededError,
    })
  ).state;
}

/** Builds the terminal coordination error used when a newer Branch Agent session owns the binding. */
export function createCodexSessionGenerationSupersededError(
  sessionId: string,
): AgentHarnessSessionSupersededError {
  return new AgentHarnessSessionSupersededError(
    `Codex session generation is no longer current: ${sessionId}`,
  );
}
