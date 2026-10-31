import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { approvalForReaTool } from "./src/rea-approval.js";

export default definePluginEntry({
  id: "harvest",
  name: "Harvest",
  description:
    "Harvest skill, the pinned REA server (rea-agents 6.4.0), and the reverse-engineer-anything skill.",
  register(api) {
    api.on("before_tool_call", (event) => approvalForReaTool(event.toolName));
  },
});
