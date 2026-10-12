// Matrix plugin module implements monitor route test support behavior.
export {
  registerSessionBindingAdapter,
  testing,
} from "branch/plugin-sdk/session-binding-runtime";
export { resolveAgentRoute } from "branch/plugin-sdk/routing";
export {
  createTestRegistry,
  setActivePluginRegistry,
} from "branch/plugin-sdk/plugin-test-runtime";
export type { BranchConfig } from "branch/plugin-sdk/config-contracts";
