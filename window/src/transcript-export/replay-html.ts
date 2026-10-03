// Adapted from bytedance/UI-TARS-desktop@2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a:
// multimodal/tarko/agent-ui-builder/src/builder.ts (SESSIONS-0049). Branch embeds its existing transcript presentation.
import type { Block } from "../thread/model";
import { buildTranscriptEntries, eventsToHtml, type TranscriptExportOptions } from "./render";
import { installReplay } from "./replay-runtime";

/** UI-TARS safeJsonStringify: never let event content terminate an embedding script. */
export function safeReplayJson(value: unknown): string {
  return JSON.stringify(value).replaceAll("<", "\\u003C").replaceAll(">", "\\u003E").replaceAll("/", "\\/");
}

function replayControls(): string {
  const speeds = [0.5, 1, 2, 4].map(speed => `<button type="button" data-replay-speed="${speed}" aria-pressed="${speed === 1}">${speed}×</button>`).join("");
  return `<nav id="branch-replay-controls" aria-label="Replay controls">
<button type="button" id="branch-replay-play">Play</button>
<button type="button" id="branch-replay-restart">Restart and play</button>
<button type="button" id="branch-replay-end">Jump to end</button>
<input id="branch-replay-position" type="range" min="0" max="1" step="0.001" value="0" aria-label="Replay position">
<output id="branch-replay-progress" aria-live="polite"></output>
<span role="group" aria-label="Playback speed">${speeds}</span></nav>`;
}

export function eventsToReplayHtml(events: readonly Block[], options: TranscriptExportOptions): string {
  const entries = buildTranscriptEntries(events, options.includeToolDetails).map(entry => ({
    ...entry, timestamp: options.includeTimestamps ? entry.timestamp : "",
  }));
  const data = safeReplayJson({ session: { id: options.sessionKey || null, title: options.title || "Conversation", model: options.model || null }, events: entries });
  const html = eventsToHtml(events, options)
    .replace("style-src 'unsafe-inline';", "style-src 'unsafe-inline'; script-src 'unsafe-inline';")
    .replace("<main>", `<main>${replayControls()}`)
    .replace('class="transcript-entries"', 'class="transcript-entries" id="branch-replay-events"');
  // Only transcript entries participate in playback; the title and model stay visible.
  const runtime = `(${installReplay.toString()})();`;
  return html.replace("</body>", `<script type="application/json" id="branch-replay-data">${data}</script><script>${runtime}</script></body>`)
    .replace("</style>", "#branch-replay-controls { position: sticky; top: 0; padding: 12px; background: #1f2937; display: flex; flex-wrap: wrap; gap: 8px; z-index: 1; } #branch-replay-events > [hidden] { display: none; } #branch-replay-position { flex: 1; }\n</style>");
}
