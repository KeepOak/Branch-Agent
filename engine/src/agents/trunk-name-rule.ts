// The one rule for a new Trunk name, used by the engine (agents.create, agents.update) and by the
// window's Add a Trunk dialog, which imports this file directly. Keep it free of imports.
// Existing Trunks keep whatever name they already have; only a new or changed name is checked.

export const TRUNK_NAME_REQUIRED = "Enter a name for this Trunk.";
export const TRUNK_NAME_DEFAULT = "Choose a distinct Trunk name, not a default name or number.";
export const TRUNK_NAME_TAKEN = "A Trunk already uses that name. Choose a unique name.";

const DEFAULT_TRUNK_NAME = /^(?:new trunk(?: \d+)?|trunk \d+|\d+)$/;

/** Whitespace collapsed and trimmed (as sanitizeAgentIdentityLine does), then lower-cased. */
export function normalizeTrunkName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** "New Trunk", "New Trunk 2", "Trunk 3" or a bare number. */
export function isDefaultTrunkName(name: string): boolean {
  return DEFAULT_TRUNK_NAME.test(normalizeTrunkName(name));
}

export type TrunkNameHolder = {
  id: string;
  name?: string | null;
  identity?: { name?: string | null } | null;
};

/**
 * Every name a Trunk answers to: its id, its configured name and its displayed identity name,
 * normalized. The agent being renamed is left out through exceptId.
 */
export function trunkNamesInUse(
  entries: readonly TrunkNameHolder[],
  exceptId?: string,
): Set<string> {
  const used = new Set<string>();
  for (const entry of entries) {
    if (exceptId !== undefined && entry.id === exceptId) {
      continue;
    }
    for (const name of [entry.id, entry.name, entry.identity?.name]) {
      const normalized = typeof name === "string" ? normalizeTrunkName(name) : "";
      if (normalized) {
        used.add(normalized);
      }
    }
  }
  return used;
}

export type TrunkNameProblem = { reason: "invalid-name" | "already-exists"; message: string };

/** Why a new Trunk name is refused, or undefined when it may be used. */
export function trunkNameProblem(
  name: string,
  used: ReadonlySet<string>,
): TrunkNameProblem | undefined {
  const normalized = normalizeTrunkName(name);
  if (!normalized) {
    return { reason: "invalid-name", message: TRUNK_NAME_REQUIRED };
  }
  if (isDefaultTrunkName(normalized)) {
    return { reason: "invalid-name", message: TRUNK_NAME_DEFAULT };
  }
  if (used.has(normalized)) {
    return { reason: "already-exists", message: TRUNK_NAME_TAKEN };
  }
  return undefined;
}
