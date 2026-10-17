// The one rule for a person's name: the footer, People, the list and search all read it from here.
// displayName, then the GitHub login, then the email's local part. Never "Owner": with nothing to show, the
// owner reads "You", and anyone else shows their id.

export const PERSON_FALLBACK = "You";
/** The engine's owner profile id (the same value as people-data OWNER_ID). */
const OWNER_ID = "gateway-owner";

type NameFields = { displayName?: unknown; githubIdentity?: unknown; emails?: unknown };
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** A person's display name. `id` is the profile id: the owner falls back to "You", anyone else to their id. */
export function personName(profile: NameFields | null | undefined, id = ""): string {
  const github = profile?.githubIdentity && typeof profile.githubIdentity === "object" ? text((profile.githubIdentity as { login?: unknown }).login) : "";
  const email = Array.isArray(profile?.emails) ? text(profile.emails[0]) : "";
  const fallback = !id || id === OWNER_ID ? PERSON_FALLBACK : id;
  return text(profile?.displayName) || github || email.split("@")[0] || fallback;
}
