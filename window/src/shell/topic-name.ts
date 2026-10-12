// Readable names for topics whose title is still an internal session key. The engine falls back to the raw
// key when a topic has no label, preview or derived title, so the window turns those keys into plain words.
const HASH_TAIL = /-[0-9a-f]{6,}$/i;

/** A session key rather than a sentence: no spaces, and an `agent:` or `a2a:` prefix, or an `a2a` segment. */
export function isRawSessionKey(name: string): boolean {
  const text = String(name ?? "").trim();
  if (!text || /\s/.test(text)) return false;
  return /^(?:agent|a2a):/i.test(text) || /:a2a:/i.test(text);
}

function sentence(text: string): string {
  return text.replace(/_+/g, "-").replace(/^./, (letter) => letter.toUpperCase());
}

/** `branch-nas-linux--tester` reads as "Talk with Tester on Nas-linux"; `branch-coordinator-a5a54c` as "Talk with Coordinator". */
function peerName(peer: string): string {
  const core = peer.replace(/^branch-/i, "").replace(HASH_TAIL, "");
  const [computer, agent] = core.split("--");
  return agent ? `Talk with ${sentence(agent)} on ${sentence(computer ?? "")}` : `Talk with ${sentence(core)}`;
}

/** A readable name for a raw session key: the other party for a2a keys, else the key's last words. */
export function sessionKeyName(key: string): string {
  const peer = key.match(/:direct:([^:\s]+)/i)?.[1] ?? key.match(/(?:^|:)a2a:([^:\s]+)/i)?.[1];
  if (peer) return peerName(peer);
  const last = (key.split(":").filter(Boolean).pop() ?? "").replace(HASH_TAIL, "");
  const words = sentence(last.replace(/[-_]+/g, " ").trim());
  return words && !/^[0-9a-f]+$/i.test(words) ? words : "Thread";
}

/** The title to show: a raw session key becomes a readable name, anything else is shown as written. */
export function readableTitle(name: string): string {
  return isRawSessionKey(name) ? sessionKeyName(name.trim()) : name;
}

/** Six hex characters that identify a key, so two threads with the same readable name can be told apart. */
export function keyTag(key: string): string {
  let hash = 0x811c9dc5;
  for (const char of key) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

/** Splits a label from distinctNames into its name and its " · tag" suffix, so the tag can stay visible when the name is cut. */
export function splitKeyTag(label: string): { name: string; tag: string } {
  const match = label.match(/^(.*) · ([0-9a-f]{6})$/);
  return match ? { name: match[1]!, tag: match[2]! } : { name: label, tag: "" };
}

/** Readable names for one list of threads: a name that repeats in the list gets the thread's key tag after " · ". */
export function distinctNames(entries: readonly { key: string; name: string }[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { name } of entries) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(entries.map(({ key, name }) => [key, (counts.get(name) ?? 0) > 1 ? `${name} · ${keyTag(key)}` : name]));
}
