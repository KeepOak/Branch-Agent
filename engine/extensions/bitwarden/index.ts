import path from "node:path";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveLivePluginConfigObject } from "branch/plugin-sdk/plugin-config-runtime";
import { definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { parseBitwardenConfig } from "./src/config.js";
import { listFillEntries, matchFillEntries } from "./src/signins.js";

const PLUGIN_ID = "bitwarden";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Bitwarden",
  description:
    "Bitwarden SecretRef resolver and the list of saved sign-ins Branch may fill, by reference only.",
  register(api) {
    const currentConfig = () => {
      const live = api.runtime.config?.current
        ? (api.runtime.config.current() as BranchConfig)
        : undefined;
      const pluginConfig = live
        ? resolveLivePluginConfigObject(
            () => live,
            PLUGIN_ID,
            api.pluginConfig as Record<string, unknown> | undefined,
          )
        : api.pluginConfig;
      return parseBitwardenConfig(pluginConfig);
    };
    const sessionFile = () =>
      path.join(
        api.runtime.state.resolveStateDir(process.env),
        "credentials",
        "bitwarden",
        "session",
      );

    api.registerCli(
      async ({ program, config }) => {
        const { registerBitwardenCommands } = await import("./src/cli.js");
        registerBitwardenCommands({
          program,
          config,
          readPluginConfig: currentConfig,
          sessionFile,
        });
      },
      {
        descriptors: [
          {
            name: PLUGIN_ID,
            description: "Manage the Bitwarden integration",
            hasSubcommands: true,
          },
        ],
      },
    );

    // The fill list carries SecretRefs, never secret values; the Gateway resolves them at fill time.
    api.registerGatewayMethod(
      "bitwarden.signins.list",
      ({ params, respond }) => {
        if (Object.keys(params).length > 0) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: "bitwarden.signins.list takes no parameters",
          });
          return;
        }
        try {
          const config = currentConfig();
          respond(true, { providerAlias: config.providerAlias, signIns: listFillEntries(config) });
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      { scope: "operator.read" },
    );
    api.registerGatewayMethod(
      "bitwarden.signins.match",
      ({ params, respond }) => {
        const url = (params as { url?: unknown }).url;
        if (typeof url !== "string" || !url.trim() || Object.keys(params).length !== 1) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: "bitwarden.signins.match takes one url",
          });
          return;
        }
        try {
          const config = currentConfig();
          respond(true, {
            providerAlias: config.providerAlias,
            signIns: matchFillEntries(config, url.trim()),
          });
        } catch (error) {
          respond(false, undefined, {
            code: "INVALID_REQUEST",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
      { scope: "operator.read" },
    );
  },
});
