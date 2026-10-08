import {
  assertOkOrThrowProviderError,
  assertProviderBinaryResponseContent,
  readProviderBinaryResponse,
} from "branch/plugin-sdk/provider-http";
import { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";

// Source: mastra-ai/mastra 486d3b7f35edfeaeab47b1230b56880e672cc421, voice/playai.
interface PlayAIVoiceInfo {
  name: string;
  accent: string;
  gender: "M" | "F";
  age: "Young" | "Middle" | "Old";
  style: "Conversational" | "Narrative";
  id: string;
}

export const PLAYAI_VOICES: PlayAIVoiceInfo[] = [
  {
    name: "Angelo",
    accent: "US",
    gender: "M",
    age: "Young",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/baf1ef41-36b6-428c-9bdf-50ba54682bd8/original/manifest.json",
  },
  {
    name: "Arsenio",
    accent: "US African American",
    gender: "M",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/65977f5e-a22a-4b36-861b-ecede19bdd65/original/manifest.json",
  },
  {
    name: "Cillian",
    accent: "Irish",
    gender: "M",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/1591b954-8760-41a9-bc58-9176a68c5726/original/manifest.json",
  },
  {
    name: "Timo",
    accent: "US",
    gender: "M",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/677a4ae3-252f-476e-85ce-eeed68e85951/original/manifest.json",
  },
  {
    name: "Dexter",
    accent: "US",
    gender: "M",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/b27bc13e-996f-4841-b584-4d35801aea98/original/manifest.json",
  },
  {
    name: "Miles",
    accent: "US African American",
    gender: "M",
    age: "Young",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/29dd9a52-bd32-4a6e-bff1-bbb98dcc286a/original/manifest.json",
  },
  {
    name: "Briggs",
    accent: "US Southern (Oklahoma)",
    gender: "M",
    age: "Old",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/71cdb799-1e03-41c6-8a05-f7cd55134b0b/original/manifest.json",
  },
  {
    name: "Deedee",
    accent: "US African American",
    gender: "F",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/e040bd1b-f190-4bdb-83f0-75ef85b18f84/original/manifest.json",
  },
  {
    name: "Nia",
    accent: "US",
    gender: "F",
    age: "Young",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/831bd330-85c6-4333-b2b4-10c476ea3491/original/manifest.json",
  },
  {
    name: "Inara",
    accent: "US African American",
    gender: "F",
    age: "Middle",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/adb83b67-8d75-48ff-ad4d-a0840d231ef1/original/manifest.json",
  },
  {
    name: "Constanza",
    accent: "US Latin American",
    gender: "F",
    age: "Young",
    style: "Conversational",
    id: "s3://voice-cloning-zero-shot/b0aca4d7-1738-4848-a80b-307ac44a7298/original/manifest.json",
  },
  {
    name: "Gideon",
    accent: "British",
    gender: "M",
    age: "Old",
    style: "Narrative",
    id: "s3://voice-cloning-zero-shot/5a3a1168-7793-4b2c-8f90-aff2b5232131/original/manifest.json",
  },
  {
    name: "Casper",
    accent: "US",
    gender: "M",
    age: "Middle",
    style: "Narrative",
    id: "s3://voice-cloning-zero-shot/1bbc6986-fadf-4bd8-98aa-b86fed0476e9/original/manifest.json",
  },
  {
    name: "Mitch",
    accent: "Australian",
    gender: "M",
    age: "Middle",
    style: "Narrative",
    id: "s3://voice-cloning-zero-shot/c14e50f2-c5e3-47d1-8c45-fa4b67803d19/original/manifest.json",
  },
  {
    name: "Ava",
    accent: "Australian",
    gender: "F",
    age: "Middle",
    style: "Narrative",
    id: "s3://voice-cloning-zero-shot/50381567-ff7b-46d2-bfdc-a9584a85e08d/original/manifest.json",
  },
];

export const PLAYAI_MODELS = ["PlayDialog", "Play3.0-mini"] as const;
export const DEFAULT_PLAYAI_MODEL = PLAYAI_MODELS[0];
export const DEFAULT_PLAYAI_VOICE = PLAYAI_VOICES[0]!.id;
export const PLAYAI_STREAM_URL = "https://api.play.ai/api/v1/tts/stream";

export type PlayAIRequest = {
  text: string;
  apiKey: string;
  userId: string;
  model?: string;
  voice?: string;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
};

export async function openPlayAIStream(params: PlayAIRequest) {
  const model = params.model ?? DEFAULT_PLAYAI_MODEL;
  if (!PLAYAI_MODELS.some((value) => value === model)) {
    throw new Error("Invalid PlayAI speech model");
  }
  if (!params.apiKey.trim()) {
    throw new Error("PlayAI API key missing");
  }
  if (!params.userId.trim()) {
    throw new Error("PlayAI userId missing");
  }
  // The same absolute timeout covers connection, error body and audio consumption.
  const deadline = AbortSignal.timeout(params.timeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
  signal.throwIfAborted();
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
    "Content-Type": "application/json",
    "X-USER-ID": params.userId,
  };
  const { response, release: releaseTransport } = await fetchWithSsrFGuard({
    url: PLAYAI_STREAM_URL,
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        text: params.text,
        voice: params.voice || DEFAULT_PLAYAI_VOICE,
        model,
      }),
      signal,
    },
    signal,
    auditContext: "playai-speech.tts",
    capture: { sensitiveRequestHeaderNames: ["authorization", "x-user-id"] },
  });
  let releasePromise: Promise<void> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const release = () =>
    (releasePromise ??= (async () => {
      signal.removeEventListener("abort", abort);
      try {
        if (reader) {
          await reader.cancel();
        } else if (!response.body?.locked) {
          await response.body?.cancel();
        }
      } finally {
        await releaseTransport();
      }
    })());
  const abort = () => {
    void release().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    await assertOkOrThrowProviderError(response, "PlayAI API Error", {
      signal,
      requestHeaders: headers,
    });
    assertProviderBinaryResponseContent(response, "PlayAI API Error", "audio");
    if (!response.body) {
      throw new Error("No response body received");
    }
    // The donor exposes the provider stream unchanged. Keep the host's validated MIME type.
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const outputFormat =
      contentType === "audio/mpeg" || contentType === "audio/mp3"
        ? "mp3"
        : contentType === "audio/wav" || contentType === "audio/x-wav"
          ? "wav"
          : contentType === "audio/ogg" || contentType === "application/ogg"
            ? "ogg"
            : "audio";
    reader = response.body.getReader();
    let size = 0;
    const audioStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          signal.throwIfAborted();
          const chunk = await reader!.read();
          signal.throwIfAborted();
          if (chunk.done) {
            if (size === 0) {
              throw new Error("PlayAI API Error: malformed audio response");
            }
            controller.close();
            await release();
            return;
          }
          size += chunk.value.byteLength;
          if (size > params.maxBytes) {
            throw new Error(`PlayAI API Error: audio response exceeds ${params.maxBytes} bytes`);
          }
          controller.enqueue(chunk.value);
        } catch (error) {
          controller.error(error);
          await release();
        }
      },
      async cancel() {
        await release();
      },
    });
    return {
      audioStream,
      release,
      signal,
      headers,
      contentType,
      outputFormat,
      fileExtension: `.${outputFormat}`,
      voiceCompatible: false,
    };
  } catch (error) {
    await release();
    throw error;
  }
}

export async function playAITTS(params: PlayAIRequest) {
  const stream = await openPlayAIStream(params);
  try {
    const audioBuffer = await readProviderBinaryResponse(
      new Response(stream.audioStream, { headers: { "Content-Type": stream.contentType! } }),
      "PlayAI API Error",
      "audio",
      { maxBytes: params.maxBytes, signal: stream.signal, requestHeaders: stream.headers },
    );
    return {
      audioBuffer,
      outputFormat: stream.outputFormat,
      fileExtension: stream.fileExtension,
      voiceCompatible: stream.voiceCompatible,
    };
  } finally {
    await stream.release();
  }
}
