// Scratch measurement harness for PR #1290 (not committed). Production Thread, fake engine, synthetic text.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WindowEngine } from "../src/connect/engine";
import type { Block } from "../src/thread/model";
import { Thread } from "../src/thread/Thread";
import "../src/theme/tokens.css";
import "../src/theme/base.css";
import "../src/shell/frame.css";

const engine: WindowEngine = {
  sessionKey: "agent:fixture:main", scopes: [], onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    return {};
  }) as WindowEngine["request"],
};

function section(i: number): string {
  const n = i + 1;
  return [
    `## Section ${n}: step ${n}`,
    "",
    `Step ${n} of the long reply. Enough prose to wrap, so the bubble grows as text arrives.`,
    "",
    `- First point for step ${n}, with **bold** and \`code\``,
    `- Second point for step ${n}`,
    `- Third point for step ${n}`,
    "",
    "```js",
    `export function step${n}(input) {`,
    `  return { step: ${n}, total: input.total * ${n} };`,
    "}",
    "```",
    "",
  ].join("\n");
}
const BASE = Array.from({ length: 35 }, (_, i) => section(i)).join("\n");
const TARGET = Number(new URLSearchParams(location.search).get("chars") || 12442);
const FILLER = "Closing notes: each step above streams in order, and this final paragraph pads the fixture to the agreed size. ";
const FULL = BASE.length >= TARGET ? BASE.slice(0, TARGET) : BASE + "\n" + FILLER.repeat(Math.ceil((TARGET - BASE.length) / FILLER.length)).slice(0, TARGET - BASE.length - 1);

const history: Block[] = [
  { kind: "user", key: "u0", text: "Walk me through the full streaming pipeline, with code for every step.", meta: { timestamp: 1_700_000_000_000 } },
];

type Opts = { chunk: number; everyMs: number };
declare global { interface Window { __fixture: { length: number; start: (o: Opts) => Promise<unknown> } } }

let setText: (t: string) => void = () => {};
let setStreaming: (s: boolean) => void = () => {};
function Harness() {
  const [text, st] = useState("");
  const [streaming, ss] = useState(true);
  useEffect(() => { setText = st; setStreaming = ss; }, []);
  const reply: Block = { kind: "text", key: "run1:text:0", text, streaming, meta: { timestamp: 1_700_000_060_000 } };
  const live: Block[] = streaming && text ? [reply] : [];
  const all = streaming ? history : [...history, reply];
  return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <Thread name="Fixture Agent" history={all} live={live} pendingUser={null} running={streaming} liveStartedAt={Date.now()} onAnswer={() => {}} engine={engine} sessionKey="agent:fixture:main" />
  </div>;
}

function pct(sorted: number[], p: number) { return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]; }

window.__fixture = {
  length: FULL.length,
  start: ({ chunk, everyMs }: Opts) => new Promise((resolve) => {
    const longTasks: { start: number; duration: number }[] = [];
    const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push({ start: Math.round(e.startTime), duration: Math.round(e.duration) }); });
    try { po.observe({ type: "longtask" }); } catch { /* unsupported */ }
    let lastMutation = performance.now();
    const content = () => document.querySelector(".stream-content");
    const mo = new MutationObserver(() => { lastMutation = performance.now(); });
    mo.observe(document.getElementById("root")!, { subtree: true, childList: true, characterData: true });
    const frames: { t: number; dt: number }[] = [];
    let prev = 0; let fed = 0; let feedDone = false; let feedEnd = 0;
    const t0 = performance.now();
    performance.mark("stream-start");
    const raf = (t: number) => {
      if (prev) frames.push({ t, dt: t - prev });
      prev = t;
      const shownAll = (content()?.textContent?.length ?? 0) > 0 && feedDone && t - lastMutation > 400;
      if (shownAll) {
        performance.mark("stream-end");
        po.disconnect(); mo.disconnect(); setStreaming(false);
        const inWindow = frames.filter((f) => f.t <= lastMutation + 1).map((f) => f.dt);
        const sorted = [...inWindow].sort((a, b) => a - b);
        const scroller = document.querySelector<HTMLElement>("[data-testid=thread-scroll]");
        const shownChars = content()?.textContent?.length ?? 0; const codeBlocks = document.querySelectorAll(".stream-content .code-block").length; const listItems = document.querySelectorAll(".stream-content li").length;
        resolve({
          characters: FULL.length, shownChars, codeBlocks, listItems, chunk, everyMs, frames: sorted.length,
          durationMs: Math.round(lastMutation - t0), feedMs: Math.round(feedEnd - t0),
          medianMs: +pct(sorted, 0.5).toFixed(2), p95Ms: +pct(sorted, 0.95).toFixed(2), p99Ms: +pct(sorted, 0.99).toFixed(2), maxMs: +sorted[sorted.length - 1].toFixed(2),
          over16_7: sorted.filter((d) => d > 16.7).length, over34: sorted.filter((d) => d > 34).length,
          longTasksOver50: longTasks.filter((l) => l.duration > 50 && l.start >= t0 && l.start <= lastMutation),
          scroll: scroller ? { top: Math.round(scroller.scrollTop), height: scroller.scrollHeight, client: scroller.clientHeight } : null,
        });
        return;
      }
      requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const timer = setInterval(() => {
      fed = Math.min(FULL.length, fed + chunk);
      setText(FULL.slice(0, fed));
      if (fed >= FULL.length) { clearInterval(timer); feedDone = true; feedEnd = performance.now(); }
    }, everyMs);
  }),
};

createRoot(document.getElementById("root")!).render(<Harness />);
