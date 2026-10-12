/** Native transcript adaptation for OpenHands/OpenHands@a8c05584 transcript export. */
import { extractThoughtChain, stripThoughtChain } from "./resume-export-plaintext.js";
export type TranscriptEntry =
  | { kind: "message"; author: "user" | "assistant"; content: string; timestamp: string }
  | { kind: "tool"; summary: string; details: string; timestamp: string }
  | { kind: "error"; content: string; timestamp: string }
  | { kind: "note"; summary: string; content: string; timestamp: string };

export interface TranscriptExportOptions {
  includeToolDetails: boolean;
  includeTimestamps: boolean;
  includeReasoning?: boolean;
  title?: string | null;
  model?: string | null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timestamp(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  return text(value);
}

function messageParts(content: unknown): Record<string, unknown>[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content.flatMap((part): Record<string, unknown>[] => {
    const value = record(part);
    return value ? [value] : [];
  }) : [];
}

function messageEntries(message: Record<string, unknown>, ts: string,
  options: TranscriptExportOptions): TranscriptEntry[] {
  const role = text(message.role);
  if (role === "toolResult" || role === "tool") {
    return [{ kind: "tool", summary: text(message.toolName) || "tool", timestamp: ts,
      details: options.includeToolDetails ? messageParts(message.content)
        .filter((part) => part.type === "text").map((part) => text(part.text)).join("\n") : "" }];
  }
  if (role !== "user" && role !== "assistant") return [];
  return messageParts(message.content).flatMap((part): TranscriptEntry[] => {
    if (part.type === "text" && part.synthetic !== true && text(part.text).trim()) {
      const value = text(part.text);
      const content = role === "assistant" ? stripThoughtChain(value) : value;
      const reasoning = role === "assistant" && options.includeReasoning ? extractThoughtChain(value) : null;
      const entries: TranscriptEntry[] = [];
      if (reasoning) entries.push({ kind: "note", summary: "Reasoning", content: reasoning, timestamp: ts });
      if (content) entries.push({ kind: "message", author: role, content, timestamp: ts });
      return entries;
    }
    if (part.type === "thinking" && options.includeReasoning && text(part.thinking).trim()) {
      return [{ kind: "note", summary: "Reasoning", content: text(part.thinking), timestamp: ts }];
    }
    if (part.type === "toolCall") {
      // Export the display name; raw arguments and signature metadata are not display content.
      return [{ kind: "tool", summary: text(part.name) || "tool", details: "", timestamp: ts }];
    }
    return [];
  });
}

/** Accepts the native active-path message event payloads, never inactive DAG siblings. */
export function nativeTranscriptEntries(events: readonly unknown[],
  options: TranscriptExportOptions): TranscriptEntry[] {
  return events.flatMap((event): TranscriptEntry[] => {
    const payload = record(event);
    const message = record(payload?.message);
    if (!message || message.display === false) return [];
    const ts = timestamp(payload?.timestamp ?? message.timestamp);
    return messageEntries(message, ts, options);
  });
}
