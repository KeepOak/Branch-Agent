// Settings › People: plain projections of the engine's people (users.list / users.self), their live connections
// (system-presence), roles (gateway.roles in config) and paired devices (device.pair.list). Shapes follow
// engine/packages/gateway-protocol/src/schema/{users,snapshot,devices}.ts. Kept in step with the People place.
import { list, record, visible, type RecordValue } from "../adapter";

/** The engine's owner profile id (gateway-protocol user-profile-constants.ts). */
export const OWNER_ID = "gateway-owner";
/** The owner's name before anyone sets one. */
export const OWNER_DEFAULT_NAME = "Owner";
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type Profile = { id: string; name: string; emails: string[]; role?: string; hasAvatar: boolean; owner: boolean };
export function profileOf(p: RecordValue): Profile {
  const id = str(p.id);
  const name = str(p.displayName) || str(record(p.githubIdentity).login) || strs(p.emails)[0] || (id === OWNER_ID ? OWNER_DEFAULT_NAME : id);
  return { id, name, emails: strs(p.emails), role: str(p.role) || undefined, hasAvatar: p.hasAvatar === true, owner: id === OWNER_ID };
}
/** Everyone in users.list, merged profiles left out (they live on in the profile they were merged into). */
export const profilesOf = (data: unknown): Profile[] => list(record(data).profiles).filter((p) => str(p.id) && !p.mergedInto).map(profileOf);

/** One live connection (schema/snapshot.ts PresenceEntry): system-presence answers a bare array. */
export type Conn = { profileId: string; deviceId: string; host: string; platform: string; ip: string; scopes: string[]; lastActivityAt?: number };
export function connsOf(data: unknown): Conn[] {
  return list(data).filter((e) => str(record(e.user).id)).map((e) => ({
    profileId: str(record(e.user).id), deviceId: str(e.deviceId), host: str(e.host), platform: str(e.platform), ip: str(e.ip),
    scopes: strs(e.scopes), lastActivityAt: num(e.lastActivityAt),
  }));
}
/** Devices "Sign out everywhere" never touches: the owner's and yours, this computer's (loopback), and any
 *  connection the engine reports without a person, which may be the owner's own. */
export function keptDevices(data: unknown, selfId: string | null): Set<string> {
  return new Set(list(data).filter((e) => {
    const who = str(record(e.user).id);
    return !who || who === OWNER_ID || who === selfId || !str(e.ip) || LOOPBACK.test(str(e.ip));
  }).map((e) => str(e.deviceId)).filter(Boolean));
}
const LOOPBACK = /^(127\.|::1$|::ffff:127\.|localhost$)/;
const isLocal = (c: Conn) => !c.ip || LOOPBACK.test(c.ip);

export type Group = "this" | "device";
export const GROUPS: Record<Group, string> = { this: "On this computer", device: "On their own device" };
/** The owner is on this computer; anyone else is where their connections come from (their own device by default). */
export function groupOf(p: Profile, conns: Conn[]): Group {
  if (p.owner) return "this";
  const mine = conns.filter((c) => c.profileId === p.id);
  return mine.length && mine.some(isLocal) ? "this" : "device";
}
export const lastActive = (conns: Conn[]): number | undefined => {
  const times = conns.map((c) => c.lastActivityAt).filter((t): t is number => t !== undefined);
  return times.length ? Math.max(...times) : undefined;
};
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "Now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return s < 172800 ? "Yesterday" : `${Math.round(s / 86400)} days ago`;
}
/** Where they use Branch: this computer for a local connection, else each device's name. */
export function devicesLine(conns: Conn[]): string {
  return [...new Set(conns.map((c) => (isLocal(c) ? "This computer" : visible(c.host || c.platform || "A device"))))].join(", ");
}

/** gateway.roles: the role names users.setRole accepts and the default for people without one. */
export type Roles = { names: string[]; fallback?: string; defs: Record<string, RecordValue> };
export function rolesOf(cfg: unknown): Roles {
  const roles = record(cfg);
  const defs = record(roles.definitions) as Record<string, RecordValue>;
  return { names: Object.keys(defs), fallback: str(roles.default) || undefined, defs };
}
export const roleOf = (p: Profile, roles: Roles): string => (p.owner ? "Owner" : p.role ?? roles.fallback ?? "");

export const ACTKINDS = ["Look things up", "Use web pages", "Write files", "Run commands", "Send messages", "Spend money", "Change how Branch is set up"];
/** What a person may do, from operator scopes: read looks things up; write uses pages, files, commands and messages;
 *  admin changes the setup. Spending money has no engine permission, so it is never ticked. The owner may do all. */
export function mayOf(owner: boolean, scopes: string[]): boolean[] {
  if (owner) return ACTKINDS.map(() => true);
  const has = (s: string) => scopes.includes(s) || scopes.includes("operator.admin");
  const write = has("operator.write");
  return [has("operator.read") || write, write, write, write, write, false, has("operator.admin")];
}
/** A person's scopes: their role's ceiling when roles are set up, else what their live connections were granted. */
export function scopesOf(p: Profile, roles: Roles, conns: Conn[]): string[] {
  const def = roles.defs[roleOf(p, roles)];
  if (def) return strs(def.scopes);
  return [...new Set(conns.filter((c) => c.profileId === p.id).flatMap((c) => c.scopes))];
}
export function accessLine(scopes: string[]): string {
  if (scopes.includes("operator.admin")) return "You may change how Branch is set up.";
  if (scopes.includes("operator.write")) return "You may send messages and make changes.";
  if (scopes.includes("operator.read")) return "You may look but not change things.";
  return "This connection may do only some things.";
}

/** "Sign out everywhere": every live token on this person's devices, never a device the owner or you use too. */
export function revokePlan(personDevices: string[], skip: Set<string>, paired: unknown): { deviceId: string; role: string }[] {
  const ids = new Set(personDevices.filter((d) => d && !skip.has(d)));
  return list(record(paired).paired).filter((d) => ids.has(str(d.deviceId).trim())).flatMap((d) =>
    list(d.tokens).filter((t) => t.revokedAtMs === undefined && str(t.role)).map((t) => ({ deviceId: str(d.deviceId).trim(), role: str(t.role) })));
}

export const PIC_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const PIC_MAX_FILE = 10 * 1048576;
/** users.setAvatar's avatarBase64 limit (schema/users.ts). */
export const PIC_MAX_BASE64 = 700_000;
export const PIC_ERRORS = { read: "That picture couldn’t be read.", size: "Pick a picture of 10 MB or less.", big: "That picture is still too big after shrinking." };
/** The checks made before a picture is read: its type and size. */
export function pictureFileError(file: { type: string; size: number }): string | null {
  if (!PIC_TYPES.includes(file.type)) return PIC_ERRORS.read;
  return file.size > PIC_MAX_FILE ? PIC_ERRORS.size : null;
}
/** A data URL → users.setAvatar's mime and raw base64 (the canvas may hand back PNG when it can't make WebP). */
export function avatarParams(dataUrl: string): { mime: string; avatarBase64: string } | string {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(dataUrl);
  if (!m || !PIC_TYPES.includes(m[1])) return PIC_ERRORS.read;
  return m[2].length > PIC_MAX_BASE64 ? PIC_ERRORS.big : { mime: m[1], avatarBase64: m[2] };
}

export const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const TONES = ["var(--ok)", "var(--accent)", "var(--warn)", "var(--bad)", "var(--screen-c)", "var(--ink-2)"];
/** A steady face colour per person from their id (theme tokens only); the owner's is the button colour. */
export function faceColour(id: string): string {
  if (id === OWNER_ID) return "var(--btn)";
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}
