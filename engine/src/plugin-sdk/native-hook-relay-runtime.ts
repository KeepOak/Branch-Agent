// Private retained native-hook relay capability for bundled runtime owners.
import type { registerOwnedNativeHookRelay } from "../agents/harness/native-hook-relay.js";

export {
  acquireHostHeavyStep,
  bindHostHeavyStep,
  createHostHeavyStepEnvironment,
  resolveHeavyStepMemoryNeed,
  type HostHeavyStepHandle,
} from "../../scripts/lib/host-heavy-step.mts";
export { resolveHeavyStepCommand } from "../infra/heavy-step-command.js";

export {
  buildNativeHookRelayCommandPlan,
  type NativeHookRelayCommandPlan,
} from "../agents/harness/native-hook-relay-plan.js";

export type OwnedNativeHookRelayParams = Parameters<typeof registerOwnedNativeHookRelay>[0];

/** Bundled owners retain child policy and record execution custody after host admission. */
export { registerOwnedNativeHookRelay as registerNativeHookRelayForBundledRuntime } from "../agents/harness/native-hook-relay.js";
