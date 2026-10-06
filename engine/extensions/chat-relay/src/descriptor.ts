// Ported from hermes-agent gateway/relay/descriptor.py (contract version 1).
export const RELAY_CONTRACT_VERSION = 1;
export const LEGACY_RELAY_OPS = ["send", "edit", "typing", "follow_up"] as const;

export type RelayDescriptor = {
  contractVersion: number;
  platform: string;
  label: string;
  maxMessageLength: number;
  supportsDraftStreaming: boolean;
  supportsEdit: boolean;
  supportsThreads: boolean;
  markdownDialect: string;
  lenUnit: "chars" | "utf16";
  emoji: string;
  platformHint: string;
  piiSafe: boolean;
  supportsContext: boolean;
  supportsInchannelContinuable: boolean;
  supportsBlockFormatting: boolean;
  supportedOps: readonly string[];
};

export function parseRelayDescriptor(value: unknown): RelayDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Relay descriptor must be an object");
  }
  const raw = value as Record<string, unknown>;
  const text = (key: string, fallback = "") => typeof raw[key] === "string" ? raw[key] as string : fallback;
  const flag = (key: string) => raw[key] === true;
  const max = Number(raw.max_message_length);
  const ops = raw.supported_ops;
  return {
    contractVersion: Number(raw.contract_version),
    platform: text("platform"),
    label: text("label"),
    maxMessageLength: Number.isInteger(max) && max > 0 ? max : 4096,
    supportsDraftStreaming: flag("supports_draft_streaming"),
    supportsEdit: flag("supports_edit"),
    supportsThreads: flag("supports_threads"),
    markdownDialect: text("markdown_dialect"),
    lenUnit: raw.len_unit === "utf16" ? "utf16" : "chars",
    emoji: text("emoji", "🔌"),
    platformHint: text("platform_hint"),
    piiSafe: flag("pii_safe"),
    supportsContext: flag("supports_context"),
    supportsInchannelContinuable: flag("supports_inchannel_continuable"),
    supportsBlockFormatting: flag("supports_block_formatting"),
    supportedOps: Array.isArray(ops) ? ops.filter((op): op is string => typeof op === "string" && op.length > 0) : [],
  };
}

export function relaySupportsOp(descriptor: RelayDescriptor, op: string): boolean {
  return (descriptor.supportedOps.length ? descriptor.supportedOps : LEGACY_RELAY_OPS).includes(op);
}

export function relayTextLength(descriptor: RelayDescriptor, value: string): number {
  return descriptor.lenUnit === "utf16" ? value.length : [...value].length;
}

export function splitRelayText(descriptor: RelayDescriptor, value: string): string[] {
  if (!value) return [];
  const chunks: string[] = [];
  let chunk = "";
  let length = 0;
  for (const character of value) {
    const units = descriptor.lenUnit === "utf16" ? character.length : 1;
    if (chunk && length + units > descriptor.maxMessageLength) {
      chunks.push(chunk);
      chunk = "";
      length = 0;
    }
    chunk += character;
    length += units;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
