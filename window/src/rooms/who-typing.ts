// Preview whoTypT5 (#31): in a group, a small line names who is typing under the dots.
// The preview takes C(b.from) or the first room member; the row has room faces and the Trunk name.

export type TypingRow = { kind: string; roomPicks?: { name: string }[] };

/** The name for "<name> is typing…", or none when the row is not a group. */
export function whoTypingName(row: TypingRow, trunkName: string): string | undefined {
  if (row.kind !== "group" && row.kind !== "chatGroup") return undefined;
  const name = row.roomPicks?.[0]?.name || trunkName;
  return name || undefined;
}

export function whoTypingLine(name: string): string {
  return `${name} is typing…`;
}
