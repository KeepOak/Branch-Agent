import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { createTrellisTool } from "./src/trellis-tool.js";

export default definePluginEntry({
  id: "trellis",
  name: "Trellis",
  description: "Optional local shell helper tools",
  register(api) {
    api.registerTool(
      (ctx) => {
        if (ctx.sandboxed) {
          return null;
        }
        return createTrellisTool(api);
      },
      { optional: true },
    );
  },
});
