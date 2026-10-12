// What a notification banner says (DESIGN-SPEC §4.10.1): the Trunk that needs a yes and what it wants to run, or the
// conversation that finished and the first line of its answer. Live words only; nothing made up.
import type { BannerNews } from "./Banner";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The first line of a chat message's text, at most 140 characters. */
export function firstLine(message: unknown): string {
  const m = rec(message);
  const parts = Array.isArray(m.content) ? m.content.map(rec) : [];
  const text = typeof m.content === "string" ? m.content : parts.filter((p) => p.type === "text").map((p) => str(p.text)).join("\n");
  const line = text.split("\n").map((l) => l.replace(/[#*_`>]/g, "").trim()).find(Boolean) ?? "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

type Names = { title: (key: string) => string; trunk: (key: string) => string };

/** The banner for an engine event about a conversation that isn't on screen, or null. */
export function bannerFor(event: string, payload: unknown, open: string | null, names: Names): BannerNews | null {
  const p = rec(payload);
  if (event === "exec.approval.requested") {
    const request = rec(p.request);
    const key = str(request.sessionKey);
    if (!key || key === open) return null;
    const trunk = names.trunk(key);
    return { trunkName: trunk, title: `${trunk} needs a yes`, text: str(request.command) || names.title(key), sessionKey: key, sameAs: `yes:${key}` };
  }
  if (event === "chat" && p.state === "final") {
    const key = str(p.sessionKey);
    if (!key || key === open) return null;
    return { trunkName: names.trunk(key), title: names.title(key), text: firstLine(p.message) || "Done", sessionKey: key };
  }
  return null;
}
