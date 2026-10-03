// Settings › Chat apps, the data side (§4.7.10): the engine's chat app catalogue and each app's live health from
// channels.status, read the way the engine's own Channels page does (engine/ui/src/pages/channels/view.ts:
// resolveChannelOrder, resolveRowState; lib/channels channelSnapshotEntryIsActive). Every word on a pill is mapped
// from the engine's state here, never written into markup.
import { list, record, text, visible, type RecordValue } from "../adapter";

export type Acct = {
  accountId: string; name?: string; enabled?: boolean; configured?: boolean; linked?: boolean; running?: boolean; connected?: boolean;
  lastError?: string | null; healthState?: string; lastStartAt?: number | null; lastInboundAt?: number | null; lastProbeAt?: number | null;
  lastTransportActivityAt?: number | null; reconnectAttempts?: number; mode?: string; tokenSource?: string; botTokenSource?: string; credentialSource?: string | null; allowFrom?: string[];
};
export type Issue = { channel: string; accountId: string; kind: string; message: string; fix?: string };
export type ChannelsStatus = {
  channelOrder?: string[]; channelLabels?: Record<string, string>; channelDetailLabels?: Record<string, string>;
  channelMeta?: { id: string; label: string; detailLabel: string }[]; channels?: Record<string, unknown>;
  channelAccounts?: Record<string, Acct[]>; channelDefaultAccountId?: Record<string, string>; statusIssues?: Issue[];
};
export type Tone = "ok" | "bad" | "work" | "idle";
export type CatalogueApp = { id: string; name: string; detail: string };
export type App = CatalogueApp & { accounts: Acct[]; on: boolean; running: boolean; paused: boolean; tone: Tone; word: string; sub: string };

/** The pill words, by tone (the preview's Online and Offline pills). */
export const PILL_WORDS: Record<Tone, string> = { ok: "Online", bad: "Offline", work: "Connecting", idle: "Stopped" };
/** The engine's unhealthy states (gateway/channel-health-policy.ts) and its grace states. */
const BAD_STATES = new Set(["disconnected", "not-running", "stale-socket", "stuck", "terminal-disconnect", "ingress-unavailable", "blocked"]);
const GRACE_STATES = new Set(["startup-connect-grace", "reconnect-grace"]);

/** Every chat app the engine has, in its own order and with its own names. */
export function catalogue(s: ChannelsStatus | undefined): CatalogueApp[] {
  const meta = s?.channelMeta ?? [];
  const ids = meta.length ? meta.map((m) => m.id) : (s?.channelOrder ?? []);
  return [...new Set(ids)].map((id) => {
    const m = meta.find((x) => x.id === id);
    const name = visible(m?.label ?? s?.channelLabels?.[id] ?? id);
    const detail = visible(m?.detailLabel ?? s?.channelDetailLabels?.[id] ?? "");
    return { id, name, detail: detail === name ? "" : detail };
  });
}

export function accountsOf(s: ChannelsStatus | undefined, id: string): Acct[] {
  return list(s?.channelAccounts?.[id]) as unknown as Acct[];
}

/** An app counts as connected when it is configured, running or connected (upstream channelSnapshotEntryIsActive). */
export function isOn(s: ChannelsStatus | undefined, id: string): boolean {
  const sum = record(s?.channels?.[id]);
  if (sum.configured === true || sum.running === true || sum.connected === true) return true;
  return accountsOf(s, id).some((a) => a.configured === true || a.running === true || a.connected === true);
}

/** "4 s ago", "12 min ago", "3 h ago", or the day. */
export function ago(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One account's tone: an issue or error first, then the engine's health state, then running. */
export function acctTone(a: Acct, issue?: Issue): Tone {
  if (a.enabled === false) return "bad";
  if (issue || (a.lastError && String(a.lastError).trim())) return "bad";
  if (a.healthState && BAD_STATES.has(a.healthState)) return "bad";
  if (a.healthState && GRACE_STATES.has(a.healthState)) return "work";
  if (a.running === true || a.connected === true) return "ok";
  return "bad";
}

/** What an account is doing, in a line: its issue or error, else its last update. */
export function acctLine(a: Acct, name: string, issue?: Issue, now = Date.now()): string {
  if (a.enabled === false) return `Paused by you. Messages wait in ${name} and get no answer until you start it.`;
  const problem = issue?.message ?? (a.lastError ? String(a.lastError) : "");
  if (problem.trim()) return visible(problem);
  if (a.healthState && GRACE_STATES.has(a.healthState)) return "Connecting…";
  if (a.running !== true && a.connected !== true) return `${name} isn’t running.`;
  const last = a.lastTransportActivityAt ?? a.lastInboundAt;
  const happy = a.healthState === "healthy" ? " · the watchdog is happy" : "";
  return last ? `Last update ${ago(last, now)}${happy}` : `Running · no messages yet${happy}`;
}

/** The app's default account (or its first), its tone, pill word and line. */
export function appOf(s: ChannelsStatus | undefined, c: CatalogueApp, now = Date.now()): App {
  const accounts = accountsOf(s, c.id);
  const defId = s?.channelDefaultAccountId?.[c.id];
  const main = accounts.find((a) => a.accountId === defId) ?? accounts[0] ?? { accountId: defId ?? "default" };
  const issue = (s?.statusIssues ?? []).find((i) => i.channel === c.id);
  const tone = acctTone(main, issue);
  const running = accounts.some((a) => a.running === true || a.connected === true);
  return { ...c, accounts, on: isOn(s, c.id), running, paused: main.enabled === false, tone, word: PILL_WORDS[tone], sub: acctLine(main, c.name, issue, now) };
}

export function connectedApps(s: ChannelsStatus | undefined): App[] {
  return catalogue(s).filter((c) => isOn(s, c.id)).map((c) => appOf(s, c));
}

/** The Trunks, as Seg/Pick options (agents.list). */
export type Trunk = { id: string; name: string };
export function trunksOf(data: RecordValue | undefined): { trunks: Trunk[]; defaultId: string } {
  const trunks = list(data?.agents).map((a) => ({ id: text(a.id), name: visible(record(a.identity).name ?? a.name ?? a.id) }));
  return { trunks, defaultId: text(data?.defaultId ?? trunks[0]?.id ?? "") };
}
