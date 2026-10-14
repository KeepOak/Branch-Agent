// + new › New Trunk on R1 (the preview's newTrunkC18): a random character and name, made at once, then its conversation
// opens and the two questions appear above the message box (shell/NewTrunkFlow.tsx). No dialog in between.
import type { WindowEngine } from "../../connect/engine";
import type { NewTrunk } from "../../shell/NewTrunkFlow";
import { createTrunk, waitForTrunk } from "./api";
import { readRoster } from "./model";
import { nextTrunkChoice } from "./NewTrunkPreview";

/** Makes a Trunk with a random name and look, waits for it, and opens its conversation through `openConversation`. */
export async function makeRandomTrunk(engine: WindowEngine, openConversation: (agentId: string) => Promise<string | null>): Promise<NewTrunk | null> {
  const roster = readRoster(await engine.request("agents.list", {}));
  const choice = nextTrunkChoice(roster);
  const agentId = await createTrunk(engine, choice.name, choice.avatar);
  await waitForTrunk(engine, agentId);
  const sessionKey = await openConversation(agentId);
  return sessionKey ? { agentId, sessionKey, name: choice.name, avatar: choice.avatar } : null;
}
