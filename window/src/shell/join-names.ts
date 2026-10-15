// A short list of names for a line of copy: each name once, then "A, B and 2 more". Used wherever a
// device, Trunk or chat list is written out, so a repeated name never reads as a stutter.

/** Names with blanks and repeats removed, in their first-seen order. */
export function uniqueNames(names: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw?.trim();
    if (name) seen.add(name);
  }
  return [...seen];
}

/** "A", "A and B", "A, B and C", or "A, B and 2 more" once there are more than `shown`. Empty input gives "". */
export function joinNames(names: readonly (string | undefined | null)[], shown = 2): string {
  const unique = uniqueNames(names);
  if (unique.length === 0) return "";
  const head = unique.slice(0, shown);
  const rest = unique.length - head.length;
  if (rest > 0) return `${head.join(", ")} and ${rest} more`;
  if (head.length === 1) return head[0];
  return `${head.slice(0, -1).join(", ")} and ${head[head.length - 1]}`;
}
