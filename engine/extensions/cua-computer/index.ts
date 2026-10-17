import { registerComputerUseProvider } from "branch/plugin-sdk/computer-use";
import { normalizePluginsConfig } from "branch/plugin-sdk/plugin-config-runtime";
import { buildPluginConfigSchema, definePluginEntry } from "branch/plugin-sdk/plugin-entry";
import { z } from "zod";
import { registerCuaDriverDoctorChecks } from "./api.js";
import { createCuaComputerProvider } from "./src/commands.js";
import { registerComputerUseRuntime } from "./src/computer-runtime.js";
import { verifyInstalledCuaDriverArtifacts } from "./src/driver-artifacts.js";
import { createCuaComputerNodeInvokePolicy } from "./src/node-invoke-policy.js";

const CuaComputerConfigSchema = z.strictObject({
  // Keep the shipped daemon setting as a named no-op: strict validation accepts
  // existing config, but direct SDK commands never receive a binary path.
  driverPath: z.string().optional(),
});

const configSchema = buildPluginConfigSchema(CuaComputerConfigSchema);

export default definePluginEntry({
  id: "cua-computer",
  name: "CUA Computer",
  description: "Experimental CUA Driver computer control for macOS, Windows, and Linux node hosts.",
  configSchema,
  register(api) {
    const parsed = CuaComputerConfigSchema.safeParse(api.pluginConfig ?? {});
    if (!parsed.success) {
      throw new Error(
        `Invalid cua-computer plugin config: ${parsed.error.issues[0]?.message ?? "invalid config"}`,
      );
    }
    api.registerNodeInvokePolicy(createCuaComputerNodeInvokePolicy());
    // Release builds fetch the driver the first time computer use is on;
    // computer.runtime reports its state.
    const onDemand = registerComputerUseRuntime(api);
    // Remote policy must not enable local native control. macOS retains its
    // app-gated default; Windows/Linux nodes still require plugin enablement.
    if (
      process.platform !== "darwin" &&
      normalizePluginsConfig(api.config.plugins).entries[api.id]?.enabled !== true
    ) {
      return;
    }
    registerCuaDriverDoctorChecks();
    const artifactVerification = verifyInstalledCuaDriverArtifacts();
    if (!artifactVerification.ok && artifactVerification.code === "COMPUTER_DRIVER_NOT_DOWNLOADED") {
      api.logger?.info?.(artifactVerification.diagnostic);
    } else if (!artifactVerification.ok) {
      api.logger?.error(artifactVerification.diagnostic);
    }
    const provider = createCuaComputerProvider();
    const enabled = normalizePluginsConfig(api.config.plugins).entries[api.id]?.enabled === true;
    registerComputerUseProvider(
      api,
      process.platform === "darwin" && enabled
        ? {
            ...provider,
            // The app starts the macOS driver, so the engine only fetches it: the first time computer use is
            // on, while the node host starts. Windows and Linux fetch it when the driver first loads.
            prepare: async (context) => {
              void onDemand
                .status()
                .then((status) => (status.state === "download" ? onDemand.ensureInstalled() : undefined))
                .catch(() => undefined);
              await provider.prepare?.(context);
            },
          }
        : provider,
    );
  },
});
