import type { AssistantMessage } from "../../../llm/types.js";
import type { StreamFn } from "../../runtime/index.js";
import { mapAssistantMessageStream, wrapStreamObjectEvents } from "./stream-wrapper.js";

type ProviderMetadata = NonNullable<AssistantMessage["providerMetadata"]>;
type MetadataCapture = {
  before: ProviderMetadata | undefined;
  id: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatedVercelID(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/.test(id) ? id : undefined;
}

/** Kilo's bounded upstream request ID metadata, independent of local call/response identity. */
export function writeProviderResponseMetadata(
  metadata: ProviderMetadata | undefined,
  headers: Record<string, string> | undefined,
): ProviderMetadata | undefined {
  const id = validatedVercelID(
    Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === "x-vercel-id")?.[1],
  );
  if (!id) {
    return metadata;
  }
  const kilo = isRecord(metadata?.kilo) ? metadata.kilo : {};
  return { ...metadata, kilo: { ...kilo, vercelID: id } };
}

export function readProviderResponseID(metadata: ProviderMetadata | undefined): string | undefined {
  return isRecord(metadata?.kilo) ? validatedVercelID(metadata.kilo.vercelID) : undefined;
}

function withoutPreviousCapture(
  current: ProviderMetadata | undefined,
  previous: MetadataCapture | undefined,
): ProviderMetadata | undefined {
  if (
    !current ||
    !previous?.id ||
    !isRecord(current.kilo) ||
    current.kilo.vercelID !== previous.id
  ) {
    return current;
  }
  const metadata = { ...current };
  const kilo = { ...current.kilo };
  const originalKilo = previous.before?.kilo;
  if (isRecord(originalKilo) && Object.hasOwn(originalKilo, "vercelID")) {
    kilo.vercelID = originalKilo.vercelID;
  } else {
    delete kilo.vercelID;
  }
  if (Object.keys(kilo).length) {
    metadata.kilo = kilo;
  } else if (originalKilo !== undefined) {
    metadata.kilo = originalKilo;
  } else {
    delete metadata.kilo;
  }
  return Object.keys(metadata).length || previous.before ? metadata : undefined;
}

function createMessageDecorator(readResponseID: () => string | undefined) {
  const originals = new WeakMap<AssistantMessage, MetadataCapture>();
  return (message: AssistantMessage) => {
    const id = readResponseID();
    const before = withoutPreviousCapture(message.providerMetadata, originals.get(message));
    const metadata = writeProviderResponseMetadata(before, id ? { "x-vercel-id": id } : undefined);
    originals.set(message, { before, id });
    if (metadata) {
      message.providerMetadata = metadata;
    } else {
      delete message.providerMetadata;
    }
  };
}

export function wrapStreamFnWithProviderResponseMetadata(streamFn: StreamFn): StreamFn {
  return (model, context, options) => {
    let responseID: string | undefined;
    const decorate = createMessageDecorator(() => responseID);
    const source = streamFn(model, context, {
      ...options,
      onResponse: (response, responseModel) => {
        // Each retry replaces the capture, including responses without a usable ID.
        responseID = readProviderResponseID(
          writeProviderResponseMetadata(undefined, response.headers),
        );
        return options?.onResponse?.(response, responseModel);
      },
    });
    return mapAssistantMessageStream(source, (stream) => {
      const result = stream.result.bind(stream);
      stream.result = async () => {
        const message = await result();
        decorate(message);
        return message;
      };
      return wrapStreamObjectEvents(stream, (event) => {
        const message = event.partial ?? event.message ?? event.error;
        if (isRecord(message) && message.role === "assistant") {
          decorate(message as unknown as AssistantMessage);
        }
      });
    });
  };
}
