// No hostname, IP address or URL in a toast or banner at Regular (card #1095, walkthrough B-026: a restart showed
// "Can’t reach <the machine's hostname>"). notify() and raiseBanner() pass their words through plainAddresses(): at
// Regular a web or connection address reads "the link", an IP address or host:port reads "that computer", and the
// hostname of the computer Branch runs on (system.info, remembered by useMachine) reads "this computer". Advanced and
// Technical keep the exact words.

/** The "How much to show" level's saved choice (places-nav/SettingsFrame readLevel); read here so toasts stay light. */
const LEVEL_KEY = "branch.level";
function regular(): boolean {
  try {
    const level = localStorage.getItem(LEVEL_KEY);
    return level !== "advanced" && level !== "technical";
  } catch {
    return true;
  }
}

const hostnames = new Set<string>();
const listeners = new Set<() => void>();

/** The computer's own hostnames, as the engine reports them, so a toast never shows them at Regular. */
export function rememberHostnames(...names: (string | null | undefined)[]): void {
  let added = false;
  for (const name of names) {
    const value = name?.trim();
    if (value && value.length > 1 && !hostnames.has(value)) {
      hostnames.add(value);
      added = true;
    }
  }
  if (added) for (const listener of listeners) listener();
}

/** Runs when a new hostname is remembered, so a toast already showing can drop it. */
export function onHostnames(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const URL_RE = /\b(?:https?|wss?|ftp|file|ssh):\/\/[^\s"'’”<>)\]]+/gi;
const IPV6_RE = /\[[0-9a-f:.]*:[0-9a-f:.]*\](?::\d{1,5})?/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g;
// A name with a network suffix (studio.local, box.tail1234.ts.net, nas.lan) or a name with a port (nas:18789, never
// a time like 12:30).
const HOST_RE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:local|lan|home|internal|localdomain|ts\.net)\b(?::\d{1,5})?|\b(?=[a-z0-9.-]*[a-z])[a-z0-9][a-z0-9.-]*[a-z0-9]:\d{2,5}\b/gi;

/** The words with every address made plain; `always` skips the level check (tests, and callers that know). */
export function plainAddresses(text: string, always = false): string {
  if (!text || (!always && !regular())) return text;
  let out = text.replace(URL_RE, "the link").replace(IPV6_RE, "that computer").replace(IPV4_RE, "that computer").replace(HOST_RE, "that computer");
  for (const name of [...hostnames].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_.-])${escape(name)}(?=$|[^\\p{L}\\p{N}_-])`, "giu"), "$1this computer");
  }
  return out;
}
