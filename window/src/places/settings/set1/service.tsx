// Service logos and names for model accounts (the preview's LOGO table and service names, §4.7.8, §4.8.4).
// A plan sign-in reads as the product people know (ChatGPT, Claude); a key reads as the company that issues it.
import { visible } from "../adapter";

const MARKS: Record<string, [string, string]> = {
  openai: ["#0F0F0F", '<path d="M12 3.2l7.6 4.4v8.8L12 20.8 4.4 16.4V7.6z" fill="none" stroke="#fff" stroke-width="1.7"/><path d="M12 7.6l3.8 2.2v4.4L12 16.4l-3.8-2.2V9.8z" fill="#fff"/>'],
  anthropic: ["#D97757", '<path d="M12 4v16M4 12h16M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>'],
  google: ["#1E1F24", '<path d="M12 3c.8 4.6 4.4 8.2 9 9-4.6.8-8.2 4.4-9 9-.8-4.6-4.4-8.2-9-9 4.6-.8 8.2-4.4 9-9z" fill="#8AB4F8"/>'],
  "github-copilot": ["#181717", '<path d="M12 4a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.5c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.3.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.4 1.1.2 1.9.1 2.1.5.6.8 1.3.8 2.1 0 3.1-1.9 3.7-3.6 3.9.3.3.5.8.5 1.5v2.2c0 .2.1.5.6.4A8 8 0 0 0 12 4z" fill="#fff"/>'],
  openrouter: ["#6566F1", "OR"],
  local: ["transparent", '<rect x="6" y="6" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'],
  keepoak: ["#1B1A18", '<path d="M12 3v2" stroke="#fff" stroke-width="1.8"/><path d="M4 10.5C4 7 7.6 5 12 5s8 2 8 5.5z" fill="#fff"/><path d="M5.7 11.5h12.6c0 5-2.7 9.5-6.3 9.5s-6.3-4.5-6.3-9.5z" fill="#E7753F"/>'],
};
const ALIAS: Record<string, string> = { "openai-codex": "openai", codex: "openai", "codex-cli": "openai", "claude-cli": "anthropic", "google-gemini-cli": "google", "gemini-cli": "google", gemini: "google", "google-vertex": "google", copilot: "github-copilot" };
const TILES = ["#56616B", "#2F6F4E", "#6B4FA0", "#9A5B2E", "#2E6C8E", "#8E3B5C", "#4E6B2F", "#5B5F97"];

export function brandOf(id: string): string {
  const key = id.toLowerCase();
  return ALIAS[key] ?? key;
}

function tileColor(id: string): string {
  let n = 0;
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TILES[n % TILES.length];
}

/** A service's logo tile: its mark when Branch has one, else two letters on a steady colour. */
export function Logo({ id, name, size = 28 }: { id: string; name?: string; size?: number }) {
  const brand = brandOf(id);
  const mark = MARKS[brand];
  const inner = mark ? mark[1] : (name ?? id).replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
  const glyph = Math.round(size * 0.66);
  return (
    <span className="logo" style={{ width: size, height: size, background: mark ? mark[0] : tileColor(brand), color: brand === "local" ? "var(--ink-3)" : undefined }} aria-hidden="true">
      {inner.startsWith("<")
        ? <svg viewBox="0 0 24 24" width={glyph} height={glyph} dangerouslySetInnerHTML={{ __html: inner }} />
        : <b style={{ font: `700 ${Math.round(size * 0.38)}px var(--sans)`, color: "#fff" }}>{inner}</b>}
    </span>
  );
}

const PLAN_NAMES: Record<string, string> = { openai: "ChatGPT", anthropic: "Claude", google: "Gemini", "github-copilot": "GitHub Copilot", openrouter: "OpenRouter" };
const KEY_NAMES: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic", google: "Google Gemini", openrouter: "OpenRouter" };

/** The name people know a service by: the product for a plan sign-in, the company for a key. */
export function serviceName(provider: string, engineName?: unknown, key?: boolean): string {
  const brand = brandOf(provider);
  const fallback = visible(engineName ?? provider);
  return (key ? KEY_NAMES[brand] : PLAN_NAMES[brand]) ?? PLAN_NAMES[brand] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
}
