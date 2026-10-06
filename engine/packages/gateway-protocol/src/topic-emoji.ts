import { TOPIC_EMOJI_CATALOG } from "./topic-emoji-catalog.js";

export const TOPIC_EMOJI = TOPIC_EMOJI_CATALOG.split("|").map((item) => {
  const index = item.search(/[a-z]/);
  const name = item.slice(index);
  return { emoji: item.slice(0, index), name, words: name.split(" ") };
});

// Preview TZ3's keyword shortcuts supplement the Unicode names ("invoice" is not an emoji name).
const SYNONYMS: Record<string, string> = {
  report: "📊📈", chart: "📊", invoice: "🧾", receipt: "🧾", bill: "🧾", expense: "🧾", trip: "✈️🧳",
  travel: "✈️", flight: "✈️", lisbon: "✈️", fare: "🎫✈️", return: "🎫", lease: "🏠📜", rent: "🏠",
  apartment: "🏠", bee: "🐝", honey: "🐝", newsletter: "📰🌱", allotment: "🌱", garden: "🌱",
  gate: "🌱", supplier: "📦", quote: "💬📦", order: "📦", paper: "📦", delivery: "🚚",
  brief: "🌅", morning: "🌅", inbox: "📥", mail: "📥", email: "✉️", sweep: "🧹", tidy: "🧹",
  ring: "🧠", memory: "🧠", date: "📅", calendar: "📅", parser: "🧩", script: "📜", folder: "📁",
  refactor: "🔧", matcher: "🧷", match: "🧷", csv: "📤", export: "📤", check: "✅", failing: "🚨",
  test: "🧪", screen: "🖥️", note: "📝", notes: "📝", river: "🌊", survey: "📋", review: "🔍",
  cloud: "☁️", statement: "📄", budget: "💰", money: "💰", september: "📊", hartwell: "🏢",
  code: "💻", fix: "🔧", bug: "🐛", research: "🔎", library: "📚", read: "📖", book: "📖",
  price: "🏷️", cheaper: "🏷️", save: "💾", week: "📆", plan: "🗺️", photo: "📷",
  picture: "🖼️", music: "🎵", health: "🩺", sales: "💹", tax: "🧮",
};
const STOP = new Set("the a an and or of to for in on at by with from my your our it is be this that every all its into than then so as up out over".split(" "));
const FALLBACK = ["💬", "🗂️", "📌", "🔖", "🧵", "📎"];
const stem = (word: string) => word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word;
const words = (value: string) => [...new Set((value.toLowerCase().match(/[a-z]+/g) ?? []).map(stem).filter((word) => word.length > 1 && !STOP.has(word)))];

export function rankTopicEmoji(title: string, firstMessage: string): [string, number][] {
  const titleWords = words(title);
  const bodyWords = words(firstMessage).filter((word) => !titleWords.includes(word));
  const score = new Map<string, number>();
  const add = (emoji: string, amount: number) => score.set(emoji, (score.get(emoji) ?? 0) + amount);
  for (const [terms, weight] of [[titleWords, 3], [bodyWords, 1]] as const) {
    terms.forEach((word, index) => {
      const synonym = SYNONYMS[word] ?? SYNONYMS[`${word}s`];
      if (synonym) [...synonym.matchAll(/\p{Extended_Pictographic}\uFE0F?/gu)].forEach((match, rank) => add(match[0], (rank ? 4 : 6) * weight - index * 0.1));
      for (const item of TOPIC_EMOJI) if (item.words.includes(word)) add(item.emoji, (item.words.length <= 2 ? 3 : 2) * weight - index * 0.1);
    });
  }
  return [...score].sort((a, b) => b[1] - a[1]);
}

/** Resolve an entire contact at once so an early generic title cannot take a later topic's best emoji. */
export function chooseTopicEmojis(topics: readonly { key: string; title: string; firstMessage: string; savedEmoji?: string }[]): Map<string, string> {
  const selected = new Map<string, string>();
  const used = new Set<string>();
  for (const topic of topics) if (topic.savedEmoji) { selected.set(topic.key, topic.savedEmoji); used.add(topic.savedEmoji); }
  const candidates = topics.flatMap((topic) => topic.savedEmoji ? [] : rankTopicEmoji(topic.title, topic.firstMessage).slice(0, 8).map(([emoji, score]) => ({ key: topic.key, emoji, score })));
  candidates.sort((a, b) => b.score - a.score);
  for (const candidate of candidates) if (!selected.has(candidate.key) && !used.has(candidate.emoji)) { selected.set(candidate.key, candidate.emoji); used.add(candidate.emoji); }
  for (const topic of topics) if (!selected.has(topic.key)) { const emoji = FALLBACK.find((candidate) => !used.has(candidate)) ?? "💬"; selected.set(topic.key, emoji); used.add(emoji); }
  return selected;
}
