import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, expect, it } from "vitest";
import {
  createRuntimeConfigReader,
  resetConfigRuntimeState,
  setRuntimeConfigSnapshot,
} from "../config/runtime-snapshot.js";
import type { BranchConfig } from "../config/types.branch.js";
import { withEnvAsync } from "../test-utils/env.js";
import {
  cleanupPluginLoaderFixturesForTest,
  loadBranchPlugins,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  writePlugin,
} from "./loader.test-fixtures.js";
import { disposePluginRegistryInstances } from "./runtime.js";
import { getPluginRuntimeLoadContext } from "./runtime/load-context.js";

afterEach(() => {
  resetConfigRuntimeState();
  resetPluginLoaderTestStateForTest();
});
afterAll(cleanupPluginLoaderFixturesForTest);

it("keeps registered callbacks on their captured config while explicit runtime readers follow refresh", async () => {
  const root = makePluginLoaderTempDir();
  const event = `config-capture:${root}`;
  let registeredConfig: BranchConfig | undefined;
  const onRegistered = (config: BranchConfig) => {
    registeredConfig = config;
  };
  const plugin = writePlugin({
    id: "config-capture",
    dir: path.join(root, "plugin"),
    body: `module.exports = { id: 'config-capture', register(api) {
      process.emit(${JSON.stringify(event)}, api.config);
      api.registerTool(() => ({
        name: 'config_capture',
        description: api.config.agents.entries.ops.name,
        parameters: { type: 'object', properties: {} },
        execute() { return { content: [] }; }
      }), { name: 'config_capture' });
    } };`,
  });
  fs.writeFileSync(
    path.join(plugin.dir, "branch.plugin.json"),
    JSON.stringify({
      id: plugin.id,
      configSchema: { type: "object", additionalProperties: false },
      contracts: { tools: ["config_capture"] },
    }),
  );
  const source: BranchConfig = {
    agents: { entries: { ops: { name: "registration snapshot" } } },
    gateway: { auth: { mode: "token", token: "${GATEWAY_TOKEN}" } },
    plugins: {
      allow: [plugin.id],
      load: { paths: [plugin.file] },
      slots: { memory: "none" },
    },
  };
  const runtime = structuredClone(source);
  runtime.gateway!.auth!.token = "synthetic-resolved-token";
  setRuntimeConfigSnapshot(runtime, source);
  process.on(event, onRegistered);
  try {
    await withEnvAsync(
      {
        BRANCH_HOME: root,
        BRANCH_STATE_DIR: path.join(root, "state"),
        BRANCH_DISABLE_BUNDLED_PLUGINS: "1",
        BRANCH_BUNDLED_PLUGINS_DIR: undefined,
      },
      async () => {
        const registry = loadBranchPlugins({
          config: runtime,
          cache: false,
          activate: false,
          runtimeSideEffects: true,
          throwOnLoadError: true,
        });
        try {
          expect(registeredConfig).toBe(getPluginRuntimeLoadContext(registry)?.config);
          if (!registeredConfig) {
            throw new Error("Expected fixture plugin registration");
          }
          const readCurrent = createRuntimeConfigReader(registeredConfig);
          expect(readCurrent()).toBe(runtime);
          runtime.agents!.entries!.ops!.name = "caller mutation";
          expect(registry.tools[0]?.factory({})).toMatchObject({
            description: "registration snapshot",
          });

          const replacement: BranchConfig = { ...runtime, gateway: { port: 19002 } };
          setRuntimeConfigSnapshot(replacement, source);
          expect(readCurrent()).toBe(replacement);
          expect(registry.tools[0]?.factory({})).toMatchObject({
            description: "registration snapshot",
          });
          expect(getPluginRuntimeLoadContext(registry)?.rawConfig).toBe(runtime);
        } finally {
          await disposePluginRegistryInstances(registry);
        }
      },
    );
  } finally {
    process.off(event, onRegistered);
  }
});
