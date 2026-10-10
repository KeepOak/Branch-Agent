// People place: reads of the engine's people, presence and conversations, kept as plain projections.
// Shapes follow engine/packages/gateway-protocol/src/schema/{users,snapshot,sessions-row,devices}.ts.
export type Rec = Record<string, unknown>;
export const rec = (v: unknown): Rec => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Rec : {};
export const recs = (v: unknown): Rec[] => Array.isArray(v) ? v.map(rec) : [];
export const str = (v: unknown): string => typeof v === "string" ? v : "";
export const num = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;
export const strs = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** The engine's owner profile id (gateway-protocol user-profile-constants.ts). */
export const OWNER_ID = "gateway-owner";

export type Profile = { id: string; displayName: string | null; emails: string[]; role?: string; mergedInto: string | null; githubLogin?: string };
export function profiles(value: unknown): Profile[] {
  return recs(rec(value).profiles).filter(p => str(p.id)).map(p => ({
    id: str(p.id), displayName: str(p.displayName) || null, emails: strs(p.emails), role: str(p.role) || undefined,
    mergedInto: str(p.mergedInto) || null, githubLogin: str(rec(p.githubIdentity).login) || undefined,
  }));
}
export const activeProfiles = (all: Profile[]) => all.filter(p => !p.mergedInto);
export const nameOf = (p: Profile) => p.displayName || p.githubLogin || p.emails[0] || p.id;
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
export const initials = (name: string) => name.trim().split(/\s+/).map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";

/** A steady colour per person, from their id (no randomness). */
const HUES = ["#2F8C86", "#8A5AA8", "#C0467A", "#4F6FA8", "#B7791F", "#3F7D4E", "#56616B", "#A0522D"];
export function personColour(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return id === OWNER_ID ? "#16212A" : HUES[h % HUES.length];
}

/** One live connection from system-presence (schema/snapshot.ts PresenceEntry). */
export type Presence = { profileId: string; name: string; host: string; platform: string; family: string; mode: string; ip: string; timeZone: string; version: string; lastInputSeconds?: number; lastActivityAt?: number; onlineSince?: number; watched: string[] };
export function presence(value: unknown): Presence[] {
  return recs(value).filter(e => str(rec(e.user).id)).map(e => ({
    profileId: str(rec(e.user).id), name: str(rec(e.user).name), host: str(e.host), platform: str(e.platform), family: str(e.deviceFamily),
    mode: str(e.mode), ip: str(e.ip), timeZone: str(e.timeZone), version: str(e.version), lastInputSeconds: num(e.lastInputSeconds),
    lastActivityAt: num(e.lastActivityAt), onlineSince: num(e.onlineSince), watched: strs(e.watchedSessions),
  }));
}
export const presenceOf = (all: Presence[], profileId: string) => all.filter(p => p.profileId === profileId);

export type Activity = "active" | "idle";
/** Active when someone touched a device in the last five minutes; the engine reports seconds since the last input. */
export function activityOf(entries: Presence[]): Activity | null {
  if (!entries.length) return null;
  const quiet = Math.min(...entries.map(e => e.lastInputSeconds ?? Number.POSITIVE_INFINITY));
  return quiet <= 300 ? "active" : "idle";
}
export const ACTIVITY_WORD: Record<Activity, string> = { active: "Active", idle: "Idle" };

const LOOPBACK = /^(127\.|::1$|localhost$)/;
/** Where a person reaches Branch from: this computer (a loopback connection) or their own device. */
export function reachOf(entries: Presence[]): "this" | "device" | null {
  if (!entries.length) return null;
  return entries.some(e => !e.ip || LOOPBACK.test(e.ip)) ? "this" : "device";
}

const KIND: Record<string, string> = { desktop: "Desktop app", mobile: "Phone app", phone: "Phone app", tablet: "Tablet", browser: "Browser", web: "Browser", cli: "Terminal", webchat: "Browser" };
export const deviceKind = (p: Presence) => KIND[p.family.toLowerCase()] || KIND[p.mode.toLowerCase()] || p.family || p.mode || "";
export const deviceName = (p: Presence) => p.host || deviceKind(p) || "Unknown device";

export function ago(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const secondsAgo = (seconds: number | undefined) => seconds === undefined ? "" : ago(Date.now() - seconds * 1000);

/** One conversation row (schema/sessions-row.ts), only the fields this place reads. */
export type Row = { key: string; sessionId: string; agentId: string; title: string; preview: string; working: boolean; status: string; updatedAt?: number; ownerId: string; ownerLabel: string; ownerType: string; visibility: string; sharingRole: string; kind: string; chatType: string; model: string; participants: string[]; swarm: Rec | null; childSessions: string[]; subagentRole: string; helper: boolean };
export function rows(value: unknown): Row[] {
  return recs(rec(value).sessions).filter(r => str(r.key)).map(r => {
    const owner = rec(rec(r.owner).actor);
    return {
      key: str(r.key), sessionId: str(r.sessionId), agentId: str(r.agentId),
      title: str(r.label) || str(r.displayName) || str(r.derivedTitle) || "Chat",
      preview: str(rec(r.observerDigest).headline) || str(r.lastMessagePreview),
      working: r.hasActiveRun === true || strs(r.activeRunIds).length > 0 || str(r.status) === "running",
      status: str(r.status), updatedAt: num(r.updatedAt), ownerId: str(owner.id), ownerLabel: str(owner.label), ownerType: str(owner.type),
      visibility: str(r.visibility), sharingRole: str(r.sharingRole), kind: str(r.kind), chatType: str(r.chatType),
      model: str(r.model), participants: recs(r.participants).map(p => str(p.label)).filter(Boolean),
      swarm: r.swarm ? rec(r.swarm) : null, childSessions: strs(r.childSessions), subagentRole: str(r.subagentRole),
      helper: Boolean(str(r.spawnedBy) || str(r.parentSessionKey)),
    };
  });
}
export type OwnerCount = { profileId: string; open: number; running: number };
export function ownerCounts(value: unknown): OwnerCount[] {
  return recs(rec(value).ownerSessionCounts).map(c => ({ profileId: str(c.profileId), open: num(c.open) ?? 0, running: num(c.running) ?? 0 })).filter(c => c.profileId);
}

/** Agent names from agents.list, so a run card can name its Trunk. */
export function trunkNames(value: unknown): Map<string, string> {
  return new Map(recs(rec(value).agents).map(a => [str(a.id), str(rec(a.identity).name) || str(a.name) || str(a.id)]));
}

/** Role names the engine accepts for users.setRole: the keys of gateway.roles.definitions (config.get). */
const roleDefs = (configSnapshot: unknown) => rec(rec(rec(rec(rec(configSnapshot).config).gateway).roles).definitions);
export const roleNames = (configSnapshot: unknown): string[] => Object.keys(roleDefs(configSnapshot));
export function roleDefinition(configSnapshot: unknown, role: string | undefined): Rec | null {
  const def = role ? roleDefs(configSnapshot)[role] : undefined;
  return def ? rec(def) : null;
}
