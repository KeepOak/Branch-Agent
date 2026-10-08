import type { WindowEngine } from "../../connect/engine";
import type { FileEntry } from "../library/data";
import { createReadyTrunk } from "./api";
import { entryOf, patchConfig, readConfig, readRoster, rec } from "./model";

// Adapted from Grok Bot's Chief of Staff template and team-in-ten-minutes charter:
// https://grokbot.dev/marketplace/chief-of-staff/ and https://grokbot.dev/use-cases/team-in-10-minutes/
// Hermes Agent's cited source has delegation tools but no matching premade role.
export const CHIEF_OF_STAFF_DESCRIPTION = "Coordinates specialist Trunks, delegates jobs, and reviews their results";
export const CHIEF_OF_STAFF_INSTRUCTIONS = `## Chief of Staff

You are the person's single point of contact for coordinated work across their Trunks. When they give you a goal, decide which existing specialist Trunk should handle each part. For a request such as "build X", split independent research, design, implementation, and review work among suitable Trunks, then integrate and check their results.

Use the Trunk roster in your context and the contacts/A2A permission rules. Delegate with sessions_send to the right Trunk; give each a clear deliverable and enough context. Track what is working, done, or blocked, follow up on handoffs, and review returned work before reporting it. Do not claim a result is complete until you have checked it. If a needed specialty is missing, suggest a specific new Trunk and its job, then use the available creation flow when asked.

Give the person a short update: what is done, what remains, what is blocked, and the one decision you need from them. Draft external messages rather than sending them without authorization. Ask before publishing, spending money, deleting anything, or resolving conflicting directions. Never invent facts or numbers.`;

const START = "<!-- branch:chief-of-staff:start -->";
const END = "<!-- branch:chief-of-staff:end -->";
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const unique = (values: string[]) => [...new Set(values)];

export function chiefInstructions(current: string): string {
  const block = `${START}\n${CHIEF_OF_STAFF_INSTRUCTIONS}\n${END}`;
  const start = current.indexOf(START), end = current.indexOf(END);
  if (start >= 0 && end > start) return current.slice(0, start) + block + current.slice(end + END.length);
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`;
}

/** Make an existing Trunk the coordinator without replacing its other instructions. */
export async function makeChiefOfStaff(engine: WindowEngine, agentId: string): Promise<void> {
  const { file } = await engine.request<{ file: FileEntry }>("agents.files.get", { agentId, name: "SOUL.md" });
  if (!file.missing && !file.hash) throw new Error("The engine did not supply a file version for a safe edit.");
  const content = chiefInstructions(file.content ?? "");
  if (content !== file.content) {
    const saved = await engine.request<{ ok: boolean }>("agents.files.set", { agentId, name: "SOUL.md", content, ...(file.missing ? { expectedMissing: true } : { expectedHash: file.hash }) });
    if (saved.ok !== true) throw new Error("The engine did not confirm the Chief of Staff instructions were saved.");
  }

  const roster = readRoster(await engine.request("agents.list", {}));
  const snap = readConfig(await engine.request("config.get", {}));
  const all = roster.agents.map((agent) => agent.id);
  const policy = rec(rec(snap.config.tools).agentToAgent);
  const changes: Record<string, unknown> = {};
  if (policy.enabled === false) changes["tools.agentToAgent.enabled"] = true;
  const globalAllow = strings(policy.allow);
  if (globalAllow.length && !globalAllow.includes("*")) changes["tools.agentToAgent.allow"] = unique([...globalAllow, ...all]);
  changes[`agents.entries.${agentId}.agentToAgent.allow`] = ["*"];
  changes[`agents.entries.${agentId}.agentToAgent.deny`] = [];
  for (const id of all) {
    if (id === agentId) continue;
    const pair = rec(entryOf(snap, id).agentToAgent);
    const allow = strings(pair.allow), deny = strings(pair.deny);
    if (deny.includes("*")) changes[`agents.entries.${id}.agentToAgent.allow`] = allow.includes("*") ? [agentId] : unique([...allow, agentId]);
    else if (allow.length && !allow.includes("*") && !allow.includes(agentId)) changes[`agents.entries.${id}.agentToAgent.allow`] = [...allow, agentId];
    const nextDeny = deny.filter((target) => target !== agentId && target !== "*");
    if (nextDeny.length !== deny.length) changes[`agents.entries.${id}.agentToAgent.deny`] = nextDeny;
  }
  await patchConfig(engine, snap, changes);
}

/** The premade creation path used by the job tile and the + menu. */
export async function createChiefOfStaff(engine: WindowEngine, current: () => boolean = () => true, chosenName?: string, avatar?: string): Promise<string> {
  const roster = readRoster(await engine.request("agents.list", {}));
  const taken = new Set(roster.agents.flatMap((agent) => [agent.id.toLowerCase(), agent.name.toLowerCase()]));
  let name = chosenName || "Chief of Staff", n = 1;
  while (taken.has(name.toLowerCase()) || taken.has(name.toLowerCase().replace(/\s+/g, "-"))) {
    if (chosenName) throw new Error(`A Trunk named ${chosenName} already exists.`);
    name = `Chief of Staff ${++n}`;
  }
  const agentId = await createReadyTrunk(engine, name, current, avatar);
  try {
    if (!current()) throw new Error("You left this screen before its role was saved.");
    await makeChiefOfStaff(engine, agentId);
    return agentId;
  } catch (error) {
    throw new Error(`Chief of Staff was created (${agentId}), but its role was not fully saved. ${error instanceof Error ? error.message : String(error)} Open Edit to finish setting it up.`);
  }
}
