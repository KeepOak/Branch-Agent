// From OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f:src/utils/transcript-export/index.ts (atlas SESSIONS-0047). Adapted to Branch thread blocks.
export type TranscriptExportFormat = "markdown" | "html" | "replay";

export interface TranscriptExportOptions {
  includeToolDetails: boolean;
  includeTimestamps: boolean;
  title?: string | null;
  model?: string | null;
  sessionKey?: string;
}

export type TranscriptEntry =
  | {
      kind: "message";
      author: "user" | "assistant";
      content: string;
      timestamp: string;
    }
  | {
      kind: "tool";
      summary: string;
      details: string;
      timestamp: string;
    }
  | {
      kind: "error";
      content: string;
      timestamp: string;
    }
  | {
      kind: "note";
      summary: string;
      content: string;
      timestamp: string;
    };

const cleanInlineText = (value: string): string =>
  value
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toISOString();
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

/**
 * GitHub Markdown permits raw HTML, so dynamic conversation text needs the
 * same inert representation as the chat's sanitized Markdown renderer.
 */
const sanitizeMarkdownText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(
      /(!?)\[([^\]]*)\]\(\s*((?:javascript|data|vbscript):[^)]*)\)/gi,
      "$1\\[$2\\]($3)",
    )
    .replace(
      /^(\s{0,3})\[([^\]]+)\]:(\s*<?(?:javascript|data|vbscript):)/gim,
      "$1\\[$2\\]:$3",
    );

const safeTitle = (title?: string | null): string =>
  cleanInlineText(title || "Conversation") ||
  "Conversation";


import type { Block } from "../thread/model";
import { markdownFence } from "./markdown-fence";
import { splitInlineThink } from "./inline-think";


export function buildTranscriptEntries(blocks: readonly Block[], includeToolDetails: boolean): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const block of blocks) {
    if (block.kind === "user" || block.kind === "text") {
      const timestamp = block.meta?.timestamp ? new Date(block.meta.timestamp).toISOString() : "";
      const attachments = block.attachments?.map(a => `[${a.kind}: ${a.name}]`).join("\n");
      const split = block.kind === "text" ? splitInlineThink(block.text, { streaming: block.streaming }) : { reasoning: "", message: block.text };
      if (split.reasoning) entries.push({ kind: "note", summary: "Thinking", content: split.reasoning, timestamp });
      const content = [split.message, attachments].filter(Boolean).join("\n");
      if (content) entries.push({ kind: "message", author: block.kind === "user" ? "user" : "assistant", content, timestamp });
    } else if (block.kind === "thinking") {
      if (block.text.trim()) entries.push({ kind: "note", summary: "Thinking", content: block.text, timestamp: "" });
    } else if (block.kind === "step") {
      entries.push({ kind: "tool", summary: block.title || block.tool, details: includeToolDetails ? [block.detail, block.output].filter(Boolean).filter((text, index, values) => values.indexOf(text) === index).join("\n\n") : "", timestamp: "" });
    } else if (block.kind === "error") {
      entries.push({ kind: "error", content: block.message, timestamp: "" });
    } else if (block.kind === "notice") {
      entries.push({ kind: "note", summary: "Note", content: block.text, timestamp: "" });
    }
  }
  return entries;
}
const markdownTimestamp = (
  entry: TranscriptEntry,
  options: TranscriptExportOptions,
): string =>
  options.includeTimestamps && entry.timestamp
    ? `<sub>${escapeHtml(formatTimestamp(entry.timestamp))}</sub>\n\n`
    : "";

export const eventsToMarkdown = (
  events: readonly Block[],
  options: TranscriptExportOptions,
): string => {
  const lines = [`# ${sanitizeMarkdownText(safeTitle(options.title))}`, ""];

  if (options.model) {
    lines.push(
      `**${"Model"}:** ${sanitizeMarkdownText(cleanInlineText(options.model))}`,
      "",
    );
  }

  for (const entry of buildTranscriptEntries(
    events,
    options.includeToolDetails,
  )) {
    const timestamp = markdownTimestamp(entry, options);
    if (entry.kind === "message") {
      const author =
        entry.author === "user"
          ? "User"
          : "Assistant";
      lines.push(
        `## ${author}`,
        "",
        timestamp + sanitizeMarkdownText(entry.content),
        "",
      );
    } else if (entry.kind === "error") {
      const quoted = entry.content
        .split("\n")
        .map((line) => `> ${sanitizeMarkdownText(line)}`)
        .join("\n");
      lines.push(
        `## ${"Error"}`,
        "",
        timestamp + quoted,
        "",
      );
    } else if (entry.kind === "note") {
      lines.push(
        `> **${escapeHtml(entry.summary)}**`,
        "",
        timestamp + sanitizeMarkdownText(entry.content),
        "",
      );
    } else if (options.includeToolDetails && entry.details) {
      lines.push(
        "<details>",
        `<summary><strong>${escapeHtml("Tool")}:</strong> ${escapeHtml(entry.summary)}</summary>`,
        "",
        timestamp + markdownFence(entry.details, "text"),
        "",
        "</details>",
        "",
      );
    } else {
      const timestampMarkup = timestamp ? `<br>${timestamp.trimEnd()}` : "";
      lines.push(
        `<p><strong>${escapeHtml("Tool")}:</strong> ${escapeHtml(entry.summary)}${timestampMarkup}</p>`,
        "",
      );
    }
  }

  return `${lines.join("\n").trim()}\n`;
};

const htmlTimestamp = (
  entry: TranscriptEntry,
  options: TranscriptExportOptions,
): string => {
  if (!options.includeTimestamps || !entry.timestamp) return "";
  const timestamp = formatTimestamp(entry.timestamp);
  return `<time datetime="${escapeHtml(timestamp)}">${escapeHtml(timestamp)}</time>`;
};

export const eventsToHtml = (
  events: readonly Block[],
  options: TranscriptExportOptions,
): string => {
  const title = safeTitle(options.title);
  const body = buildTranscriptEntries(events, options.includeToolDetails)
    .map((entry) => {
      const timestamp = htmlTimestamp(entry, options);
      if (entry.kind === "message") {
        const author =
          entry.author === "user"
            ? "User"
            : "Assistant";
        return `<section class="message ${entry.author.toLowerCase()}">
  <header><h2>${escapeHtml(author)}</h2>${timestamp}</header>
  <div class="content">${escapeHtml(entry.content)}</div>
</section>`;
      }
      if (entry.kind === "error") {
        return `<section class="message error">
  <header><h2>${escapeHtml("Error")}</h2>${timestamp}</header>
  <div class="content">${escapeHtml(entry.content)}</div>
</section>`;
      }
      if (entry.kind === "note") {
        return `<aside class="note">
  <header><strong>${escapeHtml(entry.summary)}</strong>${timestamp}</header>
  ${entry.content ? `<div class="content">${escapeHtml(entry.content)}</div>` : ""}
</aside>`;
      }
      const details =
        options.includeToolDetails && entry.details
          ? `<details>
  <summary><strong>${escapeHtml("Tool")}:</strong> ${escapeHtml(entry.summary)}${timestamp}</summary>
  <pre>${escapeHtml(entry.details)}</pre>
</details>`
          : `<div class="tool-summary"><strong>${escapeHtml("Tool")}:</strong> ${escapeHtml(entry.summary)}${timestamp}</div>`;
      return details;
    })
    .join("\n");

  const model = options.model
    ? `<p class="model"><strong>${escapeHtml("Model")}:</strong> ${escapeHtml(cleanInlineText(options.model))}</p>`
    : "";

  return `<!doctype html>
<html lang="${escapeHtml("en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #111827; color: #e5e7eb; line-height: 1.55; }
    main { box-sizing: border-box; width: min(860px, 100%); margin: 0 auto; padding: 48px 24px 80px; }
    h1 { margin: 0; font-size: 2rem; }
    h2 { margin: 0; font-size: 1rem; }
    .model { margin: 8px 0 32px; color: #9ca3af; }
    .message, details, .tool-summary, .note { margin: 16px 0; border: 1px solid #374151; border-radius: 10px; padding: 16px; background: #1f2937; }
    .user { border-left: 4px solid #9c8cf4; }
    .assistant { border-left: 4px solid #9c8cf4; }
    .error { border-left: 4px solid #f87171; }
    .note { border-left: 4px solid #a78bfa; }
    header, summary, .tool-summary { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    summary { cursor: pointer; }
    time { flex: none; color: #9ca3af; font-size: .75rem; font-weight: 400; }
    .content { margin-top: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
    pre { margin: 14px 0 0; padding: 14px; overflow-x: auto; border-radius: 7px; background: #111827; color: #d1d5db; white-space: pre-wrap; overflow-wrap: anywhere; }
    @media (prefers-color-scheme: light) {
      body { background: #f9fafb; color: #111827; }
      .message, details, .tool-summary, .note { border-color: #d1d5db; background: #fff; }
      pre { background: #f3f4f6; color: #1f2937; }
      .model, time { color: #6b7280; }
    }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${model}
    <div class="transcript-entries">${body}</div>
  </main>
</body>
</html>
`;
};
