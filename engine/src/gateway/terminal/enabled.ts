// HTTP/CSP paths need the setting without loading the terminal launch policy.
import type { BranchConfig } from "../../config/types.branch.js";

export function isTerminalConfigEnabled(config: BranchConfig | undefined): boolean {
  return config?.gateway?.terminal?.enabled !== false;
}
