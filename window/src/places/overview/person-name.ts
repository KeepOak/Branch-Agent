import type { Person } from "./engine";

/** The Gateway's own owner profile (engine state/user-profiles-owner-migration.ts). */
const OWNER_PROFILE_ID = "gateway-owner";
/** A person's name as a person reads it. A profile with no display name arrives named by its id, and an id is never
 *  shown (Private #1089): the Gateway's owner reads as Shared owner, anyone else as Someone. */
export function shownName(person: Pick<Person, "id" | "name">): string {
  const name = person.name.trim();
  if (name && name !== person.id) return name;
  return person.id === OWNER_PROFILE_ID ? "Shared owner" : "Someone";
}
