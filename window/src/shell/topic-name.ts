// Readable names for topics whose title is still an internal session key. The engine falls back to the raw
// key when a topic has no label, preview or derived title, so the window turns those keys into plain words.
const HASH_TAIL = /-[0-9a-f]{6,}$/i;

/** A session key rather than a sentence: no spaces, and either an `agent:` / `a2a:` prefix or three or more segments. */
export function isRawSessionKey(name: string): boolean {
  const text = String(name ?? "").trim();
  if (!text || /\s/.test(text)) return false;
  return /^(?:agent|a2a):/i.test(text) || /:a2a:/i.test(text) || /^[\w.-]+(?::[\w.-]+){2,}$/.test(text);
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
