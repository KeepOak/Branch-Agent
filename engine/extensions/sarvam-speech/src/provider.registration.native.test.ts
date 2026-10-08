import { fileURLToPath } from "node:url";
import type { MediaUnderstandingProvider } from "branch/plugin-sdk/media-understanding";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import type { SpeechProviderPlugin } from "branch/plugin-sdk/speech-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import manifest from "../branch.plugin.json" with { type: "json" };
import catalog from "../capability-catalog.js";
import entry from "../index.js";
afterEach(() => vi.unstubAllGlobals());
describe("Sarvam actual plugin registration and catalog", () => {
  it("is discovered by the actual host manifest reader with both contracts", () => {
    const loaded = loadPluginManifest(fileURLToPath(new URL("../", import.meta.url)));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error(loaded.error);
    }
    expect(loaded.manifest.id).toBe("sarvam-speech");
    expect(loaded.manifest.contracts?.speechProviders).toEqual(["sarvam-speech", "sarvam"]);
    expect(loaded.manifest.contracts?.mediaUnderstandingProviders).toEqual(["sarvam-speech"]);
  });
  it("registers and runs both real capabilities through production entry", async () => {
    const speech: SpeechProviderPlugin[] = [];
    const media: MediaUnderstandingProvider[] = [];
    const api: Pick<
      BranchPluginApi,
      "registerSpeechProvider" | "registerMediaUnderstandingProvider"
    > = {
      registerSpeechProvider: (p) => {
        if (typeof p === "function") {
          throw new Error("Expected Sarvam descriptor");
        }
        speech.push(p);
      },
      registerMediaUnderstandingProvider: (p) => {
        media.push(p);
      },
    };
    entry.register(api as BranchPluginApi);
    expect(entry.id).toBe(manifest.id);
    expect(speech.map((p) => p.id)).toEqual(manifest.contracts.speechProviders.slice(0, 1));
    expect(speech[0]?.aliases).toEqual(["sarvam"]);
    expect(media.map((p) => p.id)).toEqual(manifest.contracts.mediaUnderstandingProviders);
    expect(typeof speech[0]?.synthesize).toBe("function");
    expect(typeof media[0]?.transcribeAudio).toBe("function");
    expect(catalog.speechProviders[0]?.id).toBe(speech[0]?.id);
    expect(manifest.capabilityCatalogEntry).toBe("./capability-catalog.ts");
    expect(manifest.setup.providers[0]?.envVars).toEqual(["SARVAM_API_KEY"]);
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: RequestInit) => {
        calls++;
        expect(new Headers(init.headers).get("api-subscription-key")).toBe("fixture");
        return new Response(
          JSON.stringify(
            String(url).endsWith("/text-to-speech")
              ? { audios: [Buffer.from("registered-audio").toString("base64")] }
              : { transcript: "registered transcript" },
          ),
        );
      }),
    );
    expect(
      (
        await speech[0]!.synthesize({
          text: "hello",
          cfg: {},
          providerConfig: { apiKey: "fixture", baseUrl: "https://8.8.8.8" },
          target: "audio-file",
          timeoutMs: 3000,
        })
      ).audioBuffer,
    ).toEqual(Buffer.from("registered-audio"));
    expect(
      await media[0]!.transcribeAudio!({
        apiKey: "fixture",
        baseUrl: "https://8.8.8.8",
        buffer: Buffer.from("audio"),
        fileName: "fixture.wav",
        timeoutMs: 3000,
      }),
    ).toEqual({ text: "registered transcript", model: "saarika:v2.5" });
    expect(calls).toBe(2);
  });
});
