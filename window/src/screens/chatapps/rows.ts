import type { Row } from "../settings";
import type { Level } from "../settings/nav";
import type { Row as ClassicRow, Section } from "../../places/settings/set1/chatapps-kit";
import { ADVANCED, DEPTH, LATER, TECH_A } from "../../places/settings/set1/chatapps-tables";

/** The rows the page draws in its own cards. The preview shows them from Advanced (Hold up to from Technical); Regular
 *  ends after Who answers (#1049). */
export const BASE_ROWS: Row[] = [
  { id: "chatapps.replies.typing", page: "chatapps", card: "How replies look & arrive", label: "Show typing", level: 1, control: "select", source: { kind: "config", path: "agents.defaults.typingMode" }, options: [{ v: "instant", label: "Right away" }, { v: "thinking", label: "While thinking" }, { v: "message", label: "When it writes" }, { v: "never", label: "Never" }] },
  { id: "chatapps.replies.parts", page: "chatapps", card: "How replies look & arrive", label: "Long replies", level: 1, control: "select", source: { kind: "config", path: "agents.defaults.blockStreamingDefault" }, options: [{ v: "on", label: "In parts" }, { v: "off", label: "All at once" }] },
  { id: "chatapps.groups.policy", page: "chatapps", card: "Groups", label: "Groups, for every app", help: "An app’s own choice wins.", level: 1, control: "select", source: { kind: "config", path: "channels.defaults.groupPolicy" }, options: [{ v: "allowlist", label: "Groups I approve" }, { v: "open", label: "Any group" }, { v: "disabled", label: "No groups" }] },
  { id: "chatapps.commands.native", page: "chatapps", card: "Commands", label: "Commands in the app’s menu", level: 1, control: "select", source: { kind: "config", path: "commands.native" }, options: [{ v: "auto", label: "Auto" }, { v: true, label: "On" }, { v: false, label: "Off" }] },
  { id: "chatapps.commands.text", page: "chatapps", card: "Commands", label: "Typed commands", level: 1, control: "toggle", source: { kind: "config", path: "commands.text" } },
  { id: "chatapps.approvals.enabled", page: "chatapps", card: "Approvals & what Trunks may do", label: "Send approvals to chat apps", level: 1, control: "toggle", source: { kind: "config", path: "approvals.exec.enabled" } },
  { id: "chatapps.limits.queue", page: "chatapps", card: "Limits & quiet", label: "Hold up to", unit: "messages", level: 2, control: "number", source: { kind: "config", path: "messages.queue.cap" } },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "row";
/** What a row Classic greys waits for: an engine config key. */
export const NEEDS_KEY = "engine config key";

/**
 * One Classic table row (places/settings/set1/chatapps-tables, chatapps-kit) as an R1 row, drawn by RowView: the same
 * config key, choices, default, unit and scale, and the same greyed reason (Coming) where Classic has no key. Choices are
 * kept by position, so values Classic stores as undefined ("As every app") or objects still save exactly as Classic does.
 */
export function fromClassic(r: ClassicRow, id: string, card: string, level: Level): Row {
  const base = { id, page: "chatapps" as const, card, label: r.t, help: r.sub, level, ownerLevel: true as const, unit: r.unit };
  const source: Row["source"] = r.path && !r.off ? { kind: "config", path: r.path } : { kind: "coming", need: NEEDS_KEY, reason: r.off ?? "Branch has no setting for this yet." };
  const opts = r.opts ?? [];
  if (r.kind === "seg" || r.kind === "pick") {
    const options = opts.map(([label], i) => ({ v: i, label }));
    const codec = { read: (v: unknown) => { const at = opts.findIndex(([, ov]) => same(ov, v)); return at < 0 ? undefined : at; }, write: (i: unknown) => opts[Number(i)]?.[1] ?? null };
    return { ...base, control: r.kind === "seg" && opts.length <= 4 ? "segmented" : "select", options, source, codec, fallback: r.def };
  }
  if (r.kind === "sw") {
    const vals = r.vals;
    return { ...base, control: "toggle", source, fallback: r.def, ...(vals ? { codec: { read: (v: unknown) => same(v, vals[0]), write: (on: unknown) => vals[on ? 0 : 1] } } : {}) };
  }
  if (r.kind === "num") {
    const scale = r.scale ?? 1;
    return { ...base, control: "number", source, fallback: r.def, ...(scale !== 1 ? { codec: { read: (v: unknown) => (typeof v === "number" ? v / scale : v), write: (v: unknown) => (typeof v === "number" ? Math.round(v * scale) : null) } } : {}) };
  }
  // "lines" keeps one entry per line: the page draws it as a text box (More.tsx LinesRow) through the same row.
  return { ...base, control: r.kind === "lines" ? "custom" : "text", source, fallback: r.def };
}

/** Classic's Advanced and Technical sections, in Classic's order. */
export const MORE_SECTIONS: Section[] = [...ADVANCED, ...TECH_A, DEPTH, ...LATER];
const basePaths = new Set(BASE_ROWS.map(r => (r.source.kind === "config" ? r.source.path : "")));
/** A Classic row the page's own cards already draw (same key) is drawn there only. */
export const drawnAbove = (r: ClassicRow) => Boolean(r.path && basePaths.has(r.path));
/** Each Classic table row that isn't custom, as its R1 row (stable objects, so useRow keeps its state). */
export const MORE_ROWS = new Map<ClassicRow, Row>();
for (const sec of MORE_SECTIONS) for (const r of sec.rows) {
  if (r.kind === "custom" || drawnAbove(r)) continue;
  MORE_ROWS.set(r, fromClassic(r, `chatapps.more.${slug(sec.title)}.${slug(r.t)}`, sec.group ?? sec.title, (r.lv ?? sec.lv) as Level));
}

/** Public row descriptors, merged into Settings navigation (and search) by stable id. */
export const CHAT_APP_ROWS: Row[] = [...BASE_ROWS, ...MORE_ROWS.values()];
export const TELEGRAM_ADAPTER: Row = { id: "chatapps.telegram.adapter", page: "chatapps", card: "Behaviour", label: "Default adapter", level: 1, control: "custom", source: { kind: "coming", need: "channel.adapters", reason: "Adapters arrive after release." } };
