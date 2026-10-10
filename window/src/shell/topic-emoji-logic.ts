import { EMOJI_T5 } from "./topic-emoji";

// Ported from spec-v23/index.html:42289–42307 (TZ3-topics.js).
export const emojiList = EMOJI_T5.split("|").map((s) => { const i = s.search(/[a-z]/); return { e: s.slice(0, i), n: s.slice(i), w: s.slice(i).split(" ") }; });
const synonyms: Record<string, string> = { report: "📊📈", chart: "📊", invoice: "🧾", receipt: "🧾", bill: "🧾", expense: "🧾", trip: "✈️🧳", travel: "✈️", flight: "✈️", lisbon: "✈️", fare: "🎫✈️", return: "🎫",
  lease: "🏠📜", rent: "🏠", apartment: "🏠", bee: "🐝", honey: "🐝", newsletter: "📰🌱", allotment: "🌱", garden: "🌱", gate: "🌱", supplier: "📦", quote: "💬📦", order: "📦", paper: "📦",
  delivery: "🚚", brief: "🌅", morning: "🌅", inbox: "📥", mail: "📥", email: "✉️", sweep: "🧹", tidy: "🧹", ring: "🧠", memory: "🧠", date: "📅", calendar: "📅", parser: "🧩",
  script: "📜", folder: "📁", refactor: "🔧", matcher: "🧷", match: "🧷", csv: "📤", export: "📤", check: "✅", failing: "🚨", test: "🧪", screen: "🖥️", note: "📝", notes: "📝",
  river: "🌊", survey: "📋", review: "🔍", cloud: "☁️", statement: "📄", budget: "💰", money: "💰", september: "📊", hartwell: "🏢", code: "💻", fix: "🔧", bug: "🐛", research: "🔎",
  library: "📚", read: "📖", book: "📖", price: "🏷️", cheaper: "🏷️", save: "💾", week: "📆", plan: "🗺️", photo: "📷", picture: "🖼️", music: "🎵", health: "🩺", sales: "💹", tax: "🧮" };
const stop = new Set("the a an and or of to for in on at by with from my your our it is be this that every all its into than then so as up out over".split(" "));
const stem = (w: string) => w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w;
export function emojiScores(title: string, body = ""): [string, number][] {
  const words = (text: string) => [...new Set((text.toLowerCase().match(/[a-z]+/g) || []).map(stem).filter((w) => w.length > 1 && !stop.has(w)))];
  const tw = words(title), bw = words(body).filter((w) => !tw.includes(w)), score = new Map<string, number>();
  const add = (e: string, n: number) => score.set(e, (score.get(e) || 0) + n);
  ([[tw, 3], [bw, 1]] as const).forEach(([ws, k]) => ws.forEach((w, i) => {
    const syn = synonyms[w] || synonyms[w + "s"];
    if (syn) [...syn.matchAll(/\p{Extended_Pictographic}️?/gu)].forEach((m, j) => add(m[0], (j ? 4 : 6) * k - i * .1));
    emojiList.forEach((x) => { if (x.w.includes(w)) add(x.e, (x.w.length <= 2 ? 3 : 2) * k - i * .1); });
  }));
  return [...score.entries()].sort((a, b) => b[1] - a[1]);
}
export function topicEmoji(title: string, body: string, used: Set<string>): string {
  return emojiScores(title, body).find(([emoji]) => !used.has(emoji))?.[0] || ["💬", "🗂️", "📌", "🔖", "🧵", "📎"].find((emoji) => !used.has(emoji)) || "💬";
}

/** Preview lines 42342–42353: reserve explicit picks, then assign the strongest distinct matches across all threads. */
export function emojisForTopics(items: readonly { key: string; title: string; body: string }[], picks: Record<string, string>): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const item of items) if (picks[item.key]) { out[item.key] = picks[item.key]; used.add(picks[item.key]); }
  const candidates = items.flatMap((item) => out[item.key] ? [] : emojiScores(item.title, item.body).slice(0, 8).map(([emoji, score]) => ({ key: item.key, emoji, score })));
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) if (!out[candidate.key] && !used.has(candidate.emoji)) { out[candidate.key] = candidate.emoji; used.add(candidate.emoji); }
  for (const item of items) if (!out[item.key]) { out[item.key] = topicEmoji("", "", used); used.add(out[item.key]); }
  return out;
}
