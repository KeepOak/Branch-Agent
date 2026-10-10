/**
 * The team marker in a team job's brief. Two formats exist: the current one carries the role's slug before the role
 * (`team:<id>:<slug>|<Role>`), and the older one, queued before the slug existed, carries only the role
 * (`team:<id>:<Role>`). Both name the same team, and the slug of an older marker is the role in lower case.
 */
const MARKER = /<!-- team:([0-9a-f]{8}):(?:([a-z0-9-]+)\|)?([^<>|]{1,40}) -->/;

export type TeamMarker = { teamId: string; slug: string; role: string };

/** The team and role a job belongs to, or undefined for an ordinary job. Reads both marker formats. */
export function teamMarkerOf(briefText: string): TeamMarker | undefined {
  const match = MARKER.exec(briefText);
  if (!match) {
    return undefined;
  }
  const role = match[3]!;
  return { teamId: match[1]!, slug: match[2] ?? role.toLowerCase(), role };
}
