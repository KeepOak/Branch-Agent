import { randomInt } from "node:crypto";
import type { BranchConfig } from "../config/types.branch.js";

/** Branch is reserved for an explicit choice; these are the Trunk characters with complete art. */
export const TRUNK_CHARACTERS = [
  "bolt", "ember", "juniper", "kite", "lumen", "morel", "pebble", "tide", "tock", "wisp",
  "nib", "skein", "sorrel",
] as const;

export function characterId(avatar: string | undefined): string | undefined {
  const id = avatar?.replace(/^branch:/, "").match(/(?:^|\/agents\/)([^/]+)(?:\/|$)/)?.[1];
  return TRUNK_CHARACTERS.find((character) => character === id);
}

export function pickTrunkCharacter(avatars: Iterable<string | undefined>, random = randomInt): string {
  const worn = new Set(Array.from(avatars, characterId));
  const free = TRUNK_CHARACTERS.filter((id) => !worn.has(id));
  const pool = free.length ? free : TRUNK_CHARACTERS;
  return pool[random(pool.length)]!;
}

/** Called once during startup. The marker and assignments share one config publication. */
export function assignExistingTrunkCharacters(cfg: BranchConfig, random = randomInt): BranchConfig {
  if (cfg.agents?.characterAssignmentVersion === 1) return cfg;
  const entries = cfg.agents?.entries;
  if (!entries || !Object.keys(entries).length) return cfg;
  const defaultId = cfg.agents?.defaultId ?? Object.entries(entries).find(([, entry]) => (entry as { default?: boolean }).default)?.[0] ?? Object.keys(entries)[0];
  const worn = Object.values(entries).map((entry) => entry.identity?.avatar);
  const next = { ...entries };
  for (const [id, entry] of Object.entries(entries)) {
    if (id === defaultId || characterId(entry.identity?.avatar) || entry.identity?.avatar && entry.identity.avatar !== "classic") continue;
    const avatar = `branch:${pickTrunkCharacter(worn, random)}`;
    worn.push(avatar);
    next[id] = { ...entry, identity: { ...entry.identity, avatar, emoji: undefined } };
  }
  return { ...cfg, agents: { ...cfg.agents, characterAssignmentVersion: 1, entries: next } };
}
