/** Turns guest pane answers into the same tool result shapes the browser tool already returns. */
import type { AgentToolResult } from "branch/plugin-sdk/agent-core";
import { truncateUtf16Safe } from "branch/plugin-sdk/text-utility-runtime";
import { textResult } from "branch/plugin-sdk/tool-results";
import type { GuestOp } from "./guest-registry.js";

const MAX_READ_CHARS = 40_000;
const DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The page URL a guest answer reports, or an empty string. */
export function readGuestResultUrl(result: unknown): string {
  return readText(readRecord(result).url);
}

function formatTabs(result: unknown): AgentToolResult<unknown> {
  const record = readRecord(result);
  const tabs = Array.isArray(record.tabs) ? record.tabs.map(readRecord) : [];
  const activeTargetId = readText(record.activeTargetId);
  const lines = tabs.map((tab, index) => {
    const marker = readText(tab.targetId) === activeTargetId ? " (active)" : "";
    return `${index + 1}. ${readText(tab.title) || "(untitled)"} ${readText(tab.url)}${marker}`;
  });
  const text = lines.length > 0 ? lines.join("\n") : "The browser pane has no tabs open.";
  return textResult(text, result);
}

function formatRead(result: unknown): AgentToolResult<unknown> {
  const record = readRecord(result);
  const body = truncateUtf16Safe(readText(record.text), MAX_READ_CHARS);
  const text = `Page: ${readText(record.title)}\nURL: ${readText(record.url)}\n\n${body}`;
  return textResult(text, result);
}

function formatScreenshot(result: unknown): AgentToolResult<unknown> {
  const match = DATA_URL_PATTERN.exec(readText(readRecord(result).dataUrl));
  if (!match) {
    throw new Error("The browser pane sent a screenshot I can't read.");
  }
  return {
    content: [{ type: "image", data: match[2], mimeType: match[1] }],
    details: result,
  };
}

/** Format one successful guest answer for the model. */
export function formatGuestResult(op: GuestOp, result: unknown): AgentToolResult<unknown> {
  switch (op) {
    case "tabs":
      return formatTabs(result);
    case "navigate":
      return textResult(`Navigated to ${readGuestResultUrl(result)}.`, result);
    case "read":
      return formatRead(result);
    case "act":
      return textResult(`Done. The page is now at ${readGuestResultUrl(result)}.`, result);
    case "screenshot":
      return formatScreenshot(result);
  }
}
