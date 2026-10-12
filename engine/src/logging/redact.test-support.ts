import type { BranchConfig } from "../config/types.branch.js";
import { fullContextToolPayloadRedactionState } from "./redact-internal-state.js";

type LoggingConfig = BranchConfig["logging"];

export function withFullContextToolPayloadRedaction(loggingConfig: LoggingConfig): LoggingConfig {
  return fullContextToolPayloadRedactionState.mark(loggingConfig);
}
