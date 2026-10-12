import { VERSION } from "../version.js";
export { normalizeAcpProvenanceMode } from "@branch/acp-core/types";

/** ACP agent identity advertised during protocol initialization. */
export const ACP_AGENT_INFO = {
  name: "branch-acp",
  title: "Branch Agent ACP Gateway",
  version: VERSION,
};
