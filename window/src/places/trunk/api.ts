// What the Trunk family sends: agents.update / agents.create / agents.delete and config.patch on agents.entries.
// The order and params follow engine/src/gateway/server-methods/agents.ts and the config.patch merge patch.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../connect/engine";
import { mayChanges, type May } from "./may";
import { avatarFor, patchConfig, readConfig, readRoster, rec, str, type ConfigSnapshot, type Roster, type TrunkRow } from "./model";

export type Draft = { name: string; theme: string; look: string; emoji: string; model: string; may: May };

function refused(result: unknown, fallback: string): void {
  const r = rec(result);
  if (r.ok === false) throw new Error(str(rec(r.error).message) || str(r.error) || fallback);
}

/** agents.update's params for what changed; null when none of its fields did. */
export function updateParams(id: string, was: Draft, now: Draft): Record<string, unknown> | null {
  const p: Record<string, unknown> = { agentId: id };
  if (now.name.trim() && now.name.trim() !== was.name) p.name = now.name.trim();
  if (now.look !== was.look) p.avatar = avatarFor(now.look);
  if (now.emoji && now.emoji !== was.emoji) p.emoji = now.emoji;
  const fallbacksChanged = was.may.fallbacks.join("\n") !== now.may.fallbacks.join("\n");
  if (now.model !== was.model && !fallbacksChanged) p.model = now.model || null;
  return Object.keys(p).length > 1 ? p : null;
}

/** The config.patch paths for the rest of the editor: what it's for, a cleared emoji, what it may do, its computers. */
export function configChanges(snap: ConfigSnapshot, id: string, was: Draft, now: Draft): Record<string, unknown> {
  const out = mayChanges(snap, id, was.may, now.may, now.model);
  if (now.theme.trim() !== was.theme) out[`agents.entries.${id}.identity.theme`] = now.theme.trim() || null;
  if (!now.emoji && was.emoji) out[`agents.entries.${id}.identity.emoji`] = null;
  return out;
}

/** Saves the editor: agents.update first (it writes IDENTITY.md too), then one config.patch on a fresh revision. */
export async function saveTrunk(engine: WindowEngine, id: string, was: Draft, now: Draft): Promise<void> {
  const update = updateParams(id, was, now);
  if (update) refused(await engine.request("agents.update", update), "The engine did not save the Trunk.");
  const fresh = readConfig(await engine.request("config.get", {}));
  const changes = configChanges(fresh, id, was, now);
  if (Object.keys(changes).length) await patchConfig(engine, fresh, changes);
}

/** A free "New Trunk" name: the engine derives the id from the name, so two Trunks can't share one. */
export function newTrunkName(roster: Roster): string {
  const taken = new Set(roster.agents.flatMap((a) => [a.name.toLowerCase(), a.id.toLowerCase()]));
  let n = 1, name = "New Trunk";
  while (taken.has(name.toLowerCase()) || taken.has(name.toLowerCase().replace(/\s+/g, "-"))) name = `New Trunk ${++n}`;
  return name;
}

/** Creation is persisted before some engines adopt the new runtime roster. */
export async function waitForTrunk(engine: WindowEngine, id: string, current: () => boolean = () => true): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (current()) {
    const roster = readRoster(await engine.request("agents.list", {}));
    if (!current()) break;
    if (roster.agents.some((agent) => agent.id === id)) return;
    if (Date.now() >= deadline) throw new Error(`The Trunk was created (${id}), but the gateway has not made it available yet. Refresh the Trunks list before trying again.`);
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The Trunk was created (${id}), but you left this screen before it was ready.`);
}

/** Returns the persisted receipt; onboarding retains this ID across its own retryable setup steps. */
export async function createTrunk(engine: WindowEngine, name: string): Promise<string> {
  const result = rec(await engine.request("agents.create", { name }));
  refused(result, "The engine did not create the Trunk.");
  const id = str(result.agentId);
  if (!id) throw new Error("The engine did not confirm that the Trunk was created.");
  return id;
}

/** A new contact or job must also be available in the running gateway before it can be used. */
export async function createReadyTrunk(engine: WindowEngine, name: string, current: () => boolean = () => true): Promise<string> {
  if (!current()) throw new Error("You left this screen before the Trunk was created.");
  const id = await createTrunk(engine, name);
  await waitForTrunk(engine, id, current);
  return id;
}

/** agents.delete moves the Trunk's files to the Trash (deleteFiles defaults to true in the engine). */
/** Returns how many of its files didn't reach the Trash (agents.delete failed[] / purgeFailed). */
export async function removeTrunk(engine: WindowEngine, id: string): Promise<number> {
  const result = rec(await engine.request("agents.delete", { agentId: id }));
  refused(result, "The engine did not remove the Trunk.");
  const failed = Array.isArray(result.failed) ? result.failed.length : 0;
  return failed || (result.purgeFailed === true ? 1 : 0);
}

/** Why "Make default" can't run here, or "" when it can. */
export function defaultBlock(roster: Roster, id: string): string {
  if (roster.defaultId === id) return "";
  if (!roster.agents.some((a) => a.id === id)) return "This Trunk no longer exists.";
  return "";
}

/** Saves the contact default independently of explicit channel bindings and system work ownership. */
export async function makeDefault(engine: WindowEngine, roster: Roster, id: string): Promise<void> {
  const snap = readConfig(await engine.request("config.get", {}));
  const block = defaultBlock(roster, id);
  if (block) throw new Error(block);
  const changes: Record<string, unknown> = { "agents.defaultId": id };
  await patchConfig(engine, snap, changes);
}

export async function loadRoster(engine: WindowEngine): Promise<Roster> {
  return readRoster(await engine.request("agents.list", {}));
}
export const rowOf = (roster: Roster | null, id: string): TrunkRow | undefined => roster?.agents.find((a) => a.id === id);
