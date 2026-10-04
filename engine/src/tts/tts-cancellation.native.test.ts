import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createAdmittedHostCapabilityTestFixture } from "../agents/harness/host-capability.test-support.js";
import { readProviderBinaryResponse } from "../agents/provider-http-errors.js";
import type { BranchConfig } from "../config/types.js";
import { resetAgentRunRegistryForTest } from "../infra/agent-run-registry.js";
import {
  cleanupPluginLoaderFixturesForTest,
  makePluginLoaderTempDir,
  resetPluginLoaderTestStateForTest,
  useNoBundledPlugins,
  writePlugin,
} from "../plugins/loader.test-fixtures.js";
import { clearPluginMetadataLifecycleCaches } from "../plugins/plugin-metadata-lifecycle.js";
import { createDeferredCore } from "../shared/deferred.js";
import { withEnvAsync } from "../test-utils/env.js";
import type {
  SpeechProviderPrepareSynthesisContext,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from "./provider-types.js";
import { setTtsMachinePrefsPathResolver } from "./tts-settings.js";
import { streamSpeech } from "./tts-streaming.js";
import { synthesizeSpeech } from "./tts-synthesis.js";

const audio: SpeechSynthesisResult = {
  audioBuffer: Buffer.from("offline fixture audio"),
  outputFormat: "mp3",
  fileExtension: ".mp3",
  voiceCompatible: false,
};

function createFixture() {
  const dir = makePluginLoaderTempDir();
  const key = `__branch_tts_cancel_${path.basename(dir)}`;
  const started = createDeferredCore();
  const state = {
    requests: [] as Array<{ id: string; request: SpeechSynthesisRequest }>,
    prepared: [] as SpeechProviderPrepareSynthesisContext[],
    disposals: 0,
    bodyCanceled: 0,
    streamReleases: 0,
    streamBodyCanceled: 0,
    prepare: async (_request: SpeechProviderPrepareSynthesisContext): Promise<void> => {},
    synthesize: async (_id: string, _request: SpeechSynthesisRequest) => audio,
  };
  Object.defineProperty(globalThis, key, { configurable: true, value: state });
  const id = "cancel-speech";
  const plugin = writePlugin({
    dir,
    id,
    body: `module.exports = { id: "cancel-speech", register(api) {
      const state = globalThis[${JSON.stringify(key)}];
      api.lifecycle.registerRuntimeLifecycle({ id: "cancel-fixture", dispose() { state.disposals++; } });
      for (const [id, order] of [["cancel-primary", 1], ["cancel-fallback", 2]]) {
        api.registerSpeechProvider({
          id, label: id, autoSelectOrder: order,
          defaultModel: "fixture-model", models: ["fixture-model"],
          isConfigured() { return true; },
          async prepareSynthesis(request) { state.prepared.push(request); await state.prepare(request); },
          async synthesize(request) {
            state.requests.push({ id, request });
            return await state.synthesize(id, request);
          },
          async streamSynthesize(request) {
            const result = await this.synthesize(request);
            return { ...result,
              audioStream: new ReadableStream({ start(c) { c.enqueue(result.audioBuffer); }, cancel() { state.streamBodyCanceled++; } }),
              async release() { state.streamReleases++; },
            };
          },
        });
      }
    } };`,
  });
  fs.writeFileSync(
    path.join(dir, "branch.plugin.json"),
    JSON.stringify({
      id,
      contracts: { speechProviders: ["cancel-primary", "cancel-fallback"] },
      configSchema: { type: "object", additionalProperties: false },
    }),
  );
  const cfg: BranchConfig = {
    plugins: { allow: [id], load: { paths: [plugin.file] }, slots: { memory: "none" } },
    tts: { provider: "cancel-primary", providers: { "cancel-primary": {}, "cancel-fallback": {} } },
    agents: {
      defaults: {
        voiceModel: {
          primary: "cancel-primary/fixture-model",
          fallbacks: ["cancel-fallback/fixture-model"],
        },
      },
    },
  };
  const prefsPath = path.join(dir, "prefs.json");
  fs.writeFileSync(prefsPath, "{}");
  return {
    cfg,
    prefsPath,
    state,
    started,
    stallBody(useProviderDeadline = false) {
      state.synthesize = async (providerId, request) => {
        if (providerId === "cancel-fallback") {
          return audio;
        }
        const response = new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from("partial"));
            },
            cancel() {
              state.bodyCanceled++;
            },
          }),
          { headers: { "content-type": "audio/mpeg" } },
        );
        started.resolve();
        return {
          ...audio,
          audioBuffer: await readProviderBinaryResponse(response, "offline speech", "audio", {
            signal: request.signal,
            ...(useProviderDeadline ? { timeoutMs: request.timeoutMs } : {}),
          }),
        };
      };
    },
    run: (run: () => Promise<void>) =>
      withEnvAsync(
        {
          BRANCH_HOME: dir,
          BRANCH_STATE_DIR: dir,
          BRANCH_CONFIG_PATH: path.join(dir, "config.json"),
        },
        async () => {
          useNoBundledPlugins();
          setTtsMachinePrefsPathResolver(() => prefsPath);
          try {
            await run();
          } finally {
            setTtsMachinePrefsPathResolver();
          }
        },
      ),
    cleanup() {
      Reflect.deleteProperty(globalThis, key);
    },
  };
}

afterEach(() => {
  clearPluginMetadataLifecycleCaches();
  resetPluginLoaderTestStateForTest();
  resetAgentRunRegistryForTest();
});
afterAll(cleanupPluginLoaderFixturesForTest);

describe("registered speech provider host cancellation", () => {
  it.each(["attempt", "request"] as const)(
    "cancels the stalled HTTP body through the admitted host tool %s signal without fallback",
    async (owner) => {
      const fixture = createFixture();
      fixture.stallBody();
      try {
        await fixture.run(async () => {
          const parent = new AbortController();
          const host = await createAdmittedHostCapabilityTestFixture({
            runId: "tts-cancel-host",
            config: fixture.cfg,
            ...(owner === "attempt" ? { abortSignal: parent.signal } : {}),
          });
          try {
            const tool = host.hostCapabilities
              .createToolSurface?.({ config: fixture.cfg })
              .find((candidate) => candidate.name === "tts");
            if (!tool) {
              throw new Error("host must register its core TTS tool");
            }
            const pending = tool.execute(
              "tts-body",
              {
                text: "cancel this speech",
                timeoutMs: 12345,
              },
              owner === "request" ? parent.signal : undefined,
            );
            const reason = new Error("host turn canceled");
            const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
            await fixture.started.promise;
            parent.abort(reason);
            await rejected;
            await expect.poll(() => fixture.state.disposals).toBeGreaterThan(0);
            expect(fixture.state.requests.map((entry) => entry.id)).toEqual(["cancel-primary"]);
            expect(fixture.state.requests[0]?.request.signal?.aborted).toBe(true);
            expect(fixture.state.requests[0]?.request.signal?.reason).toBe(reason);
            expect(fixture.state.requests[0]?.request.timeoutMs).toBe(12345);
            expect(fixture.state.prepared[0]?.signal).toBe(
              fixture.state.requests[0]?.request.signal,
            );
            expect(fixture.state.bodyCanceled).toBe(1);
            expect(fixture.state.disposals).toBeGreaterThan(0);
          } finally {
            host.closeHost();
            host.closeAdmission();
          }
        });
      } finally {
        fixture.cleanup();
      }
    },
  );

  it("cancels an elapsed provider body deadline and retains fallback while the parent is active", async () => {
    const fixture = createFixture();
    fixture.stallBody(true);
    const parent = new AbortController();
    try {
      await fixture.run(async () => {
        const result = await synthesizeSpeech({
          text: "provider deadline",
          cfg: fixture.cfg,
          prefsPath: fixture.prefsPath,
          signal: parent.signal,
          timeoutMs: 50,
        });
        expect(result.success).toBe(true);
        expect(result.provider).toBe("cancel-fallback");
        expect(result.attemptedProviders).toEqual(["cancel-primary", "cancel-fallback"]);
        expect(result.attempts?.[0]?.reasonCode).toBe("timeout");
        expect(fixture.state.bodyCanceled).toBe(1);
        expect(parent.signal.aborted).toBe(false);
      });
    } finally {
      fixture.cleanup();
    }
  });

  it.each([synthesizeSpeech, streamSpeech])(
    "forwards a supplied parent signal through synthesis and cancels a stalled body (%#)",
    async (synthesize) => {
      const fixture = createFixture();
      fixture.stallBody();
      try {
        await fixture.run(async () => {
          const parent = new AbortController();
          const reason = new Error("speech parent canceled");
          const pending = synthesize({
            text: "cancel speech",
            cfg: fixture.cfg,
            prefsPath: fixture.prefsPath,
            signal: parent.signal,
          });
          const rejected = expect(pending).rejects.toBe(reason);
          await fixture.started.promise;
          parent.abort(reason);
          await rejected;
          expect(fixture.state.requests.map((entry) => entry.id)).toEqual(["cancel-primary"]);
          expect(fixture.state.requests[0]?.request.signal).toBe(parent.signal);
          expect(fixture.state.bodyCanceled).toBe(1);
        });
      } finally {
        fixture.cleanup();
      }
    },
  );

  it("does not synthesize after parent cancellation during preparation", async () => {
    const fixture = createFixture();
    const parent = new AbortController();
    const reason = new Error("canceled during preparation");
    fixture.state.prepare = async (request) => {
      expect(request.signal).toBe(parent.signal);
      parent.abort(reason);
    };
    try {
      await fixture.run(async () => {
        await expect(
          synthesizeSpeech({
            text: "prepare",
            cfg: fixture.cfg,
            prefsPath: fixture.prefsPath,
            signal: parent.signal,
          }),
        ).rejects.toBe(reason);
        expect(fixture.state.requests).toEqual([]);
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("releases a provider stream if its parent aborts before success projection", async () => {
    const fixture = createFixture();
    const parent = new AbortController();
    const reason = new Error("canceled before stream projection");
    fixture.state.synthesize = async () => {
      parent.abort(reason);
      return audio;
    };
    try {
      await fixture.run(async () => {
        await expect(
          streamSpeech({
            text: "stream projection",
            cfg: fixture.cfg,
            prefsPath: fixture.prefsPath,
            signal: parent.signal,
          }),
        ).rejects.toBe(reason);
        expect(fixture.state.requests.map((entry) => entry.id)).toEqual(["cancel-primary"]);
        expect(fixture.state.streamBodyCanceled).toBe(1);
        expect(fixture.state.streamReleases).toBe(1);
      });
    } finally {
      fixture.cleanup();
    }
  });

  it("does not invoke providers for an already canceled parent", async () => {
    const fixture = createFixture();
    const reason = new Error("already canceled");
    try {
      await fixture.run(async () => {
        await expect(
          synthesizeSpeech({
            text: "no request",
            cfg: fixture.cfg,
            prefsPath: fixture.prefsPath,
            signal: AbortSignal.abort(reason),
          }),
        ).rejects.toBe(reason);
        expect(fixture.state.prepared).toEqual([]);
        expect(fixture.state.requests).toEqual([]);
      });
    } finally {
      fixture.cleanup();
    }
  });

  it.each([
    new DOMException("provider deadline", "TimeoutError"),
    new DOMException("provider aborted its request", "AbortError"),
    new Error("provider unavailable"),
  ])("keeps fallback for provider failures while the parent is active (%#)", async (error) => {
    const fixture = createFixture();
    const parent = new AbortController();
    fixture.state.synthesize = async (id) => {
      if (id === "cancel-primary") {
        throw error;
      }
      return audio;
    };
    try {
      await fixture.run(async () => {
        const result = await synthesizeSpeech({
          text: "fallback",
          cfg: fixture.cfg,
          prefsPath: fixture.prefsPath,
          signal: parent.signal,
          timeoutMs: 4321,
        });
        expect(result.success).toBe(true);
        expect(result.provider).toBe("cancel-fallback");
        expect(result.attemptedProviders).toEqual(["cancel-primary", "cancel-fallback"]);
        expect(
          fixture.state.requests.every(
            ({ request }) => request.signal === parent.signal && request.timeoutMs === 4321,
          ),
        ).toBe(true);
        expect(parent.signal.aborted).toBe(false);
      });
    } finally {
      fixture.cleanup();
    }
  });
});
