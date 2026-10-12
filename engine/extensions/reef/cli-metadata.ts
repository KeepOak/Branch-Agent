import type { BranchPluginApi } from "branch/plugin-sdk/channel-plugin-common";
import { definePluginEntry } from "branch/plugin-sdk/core";

export function registerReefCliMetadata(api: BranchPluginApi) {
  api.registerCli(
    async ({ program }) => {
      const { registerReefCli } = await import("./src/cli.js");
      registerReefCli({ program });
    },
    {
      descriptors: [
        {
          name: "reef",
          description: "Register on a Reef relay and manage guarded grove-to-grove friendships",
          hasSubcommands: true,
        },
      ],
    },
  );
}

export default definePluginEntry({
  id: "reef",
  name: "Reef",
  description: "Guarded end-to-end encrypted grove channel",
  register: registerReefCliMetadata,
});
