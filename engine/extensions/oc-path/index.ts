// OC Path plugin entrypoint registers its Branch Agent integration.
import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { registerOcPathCli } from "./cli-registration.js";

export default definePluginEntry({
  id: "oc-path",
  name: "OC Path",
  description: "Adds the branch path CLI for oc:// workspace file addressing.",
  register(api) {
    registerOcPathCli(api);
  },
});
