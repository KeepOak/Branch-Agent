// Improve my draft (R1-04, #977): one question to the conversation's side model (sessions.companion.ask) that rewrites
// the draft. The answer replaces the draft only if the person hasn't typed since; Undo puts the old text back.

/** The question sent with the draft. The side model sees the conversation, so the rewrite fits it. */
export function improvePrompt(draft: string): string {
  return [
    "Rewrite the draft message below so it is clear and well written.",
    "Keep its meaning, language and tone. Keep any @mentions, /commands, links and code exactly as they are.",
    "Reply with only the rewritten message: no preface, no quotes, no explanation.",
    "",
    "<draft>",
    draft,
    "</draft>",
  ].join("\n");
}

/** The rewrite from the side model's answer, without wrapping tags, fences or quotes; empty when there is none. */
export function improvedText(answer: unknown): string {
  if (typeof answer !== "string") return "";
  let text = answer.trim();
  const tagged = /^<draft>\s*([\s\S]*?)\s*<\/draft>$/.exec(text);
  if (tagged) text = tagged[1].trim();
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1].trim();
  if (text.length > 1 && /^["“]/.test(text) && /["”]$/.test(text)) text = text.slice(1, -1).trim();
  return text;
}
