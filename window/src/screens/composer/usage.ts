// What the ring shows (preview tightP17, ctxP17, ringP17), read only from engine facts: usage.status rows (shell/use-status
// useLimits), the conversation's sessions.list totalTokens / contextTokens, and the conversations that are working now.
import type { Limits } from "../../shell/status-data";

/** The preview's ctxP17 fmt: "36k", "1M", "1.2M". */
export function tokenWords(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`;
  return n >= 1000 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
}

export type Tightest = { percent: number; name: string; when: string };

/** The highest 5-hour or weekly use across every account; null when no account reports a window. */
export function tightest(limits: Limits | null): Tightest | null {
  let best: Tightest | null = null;
  for (const row of limits?.rows ?? []) {
    for (const window of row.windows) {
      const percent = Math.max(0, Math.min(100, 100 - window.left));
      const week = /week/i.test(window.name);
      const when = week ? "this week" : `this 5-hour window${window.reset ? `, ${window.reset}` : ""}`;
      if (!best || percent > best.percent) best = { percent, name: row.name, when };
    }
  }
  return best;
}

export type ContextUse = { percent: number; line: string };

/** "36K / 256K (14%)"; null until the engine reports both numbers for this conversation. */
export function contextUse(totalTokens: number | undefined, contextTokens: number | undefined): ContextUse | null {
  if (!totalTokens || !contextTokens || totalTokens < 0 || contextTokens <= 0) return null;
  const percent = Math.min(100, Math.round((totalTokens / contextTokens) * 100));
  return { percent, line: `${tokenWords(totalTokens)} / ${tokenWords(contextTokens)} (${percent}%)` };
}

/** The ring's tooltip and accessible name: every part, and plainly what isn't known yet. */
export function ringSummary(usage: Tightest | null, running: number, context: ContextUse | null): string {
  return [
    usage ? `Usage ${usage.percent}% (${usage.name}, ${usage.when})` : "Usage not reported yet",
    running ? `${running} running` : "nothing running",
    context ? `context ${context.line}` : "context not measured yet",
  ].join(" · ");
}
