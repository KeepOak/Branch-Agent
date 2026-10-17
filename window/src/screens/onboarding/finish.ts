// Meet them (preview item 37 `finish`, HANDOFF R1-07 "First conversation"): create the picked Trunks from the day-one
// templates with trunks.template.create (the #1304 first-run contract: the owner's timezone, the questions' defaults, routines
// paused until the owner's Start), write the setup record so the card never opens by itself again, and send the first
// message into the first new Trunk's main conversation (or the default Trunk's). A failed create keeps the person on step 4
// with the engine's words; the Trunks already made are remembered so Try again never makes a second copy.
import type { WindowEngine } from "../../connect/engine";
import { readOutcome } from "../../places/customize/trunk-templates";
import { errorText } from "../../places/settings/adapter";
import { freshChoices } from "../../setup/setup-model";
import { recordSetup } from "../../setup/use-setup-engine";
import { DAY_ONE_TEMPLATES, type ListedTemplate } from "../seedbank/templates";
import { carried, greeting, mainSessionOf, ownerTimeZone, type OnboardingState } from "./model";
import { trunkDisplayName } from "../../connect/trunk-name";

export type Made = { templateId: string; agentId: string; name: string };
export type DefaultTrunk = { id: string; name: string; mainKey: string };

/** agents.list: the default Trunk (its id, name and main key), or null when the list doesn't name one. */
export function readDefaultTrunk(value: unknown): DefaultTrunk | null {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const str = (x: unknown) => (typeof x === "string" ? x : "");
  const id = str(v.defaultId);
  if (!id) return null;
  const agents = Array.isArray(v.agents) ? (v.agents as Record<string, unknown>[]) : [];
  const row = agents.find((a) => a && a.id === id) ?? {};
  return { id, name: trunkDisplayName({ ...row, id }), mainKey: str(v.mainKey) || "main" };
}

/** Creates each picked template that isn't made yet, in order. Stops at the first failure with the engine's words. */
export async function createPicked(engine: WindowEngine, ids: readonly string[], listed: readonly ListedTemplate[] | null, made: readonly Made[]): Promise<{ made: Made[]; error: string | null }> {
  const out = [...made];
  const timezone = ownerTimeZone();
  for (const id of ids) {
    if (out.some((m) => m.templateId === id)) continue;
    const template = DAY_ONE_TEMPLATES.find((t) => t.id === id);
    if (!template) continue;
    const engineCopy = carried(template, listed);
    if ("reason" in engineCopy) return { made: out, error: engineCopy.reason };
    try {
      const result = await engine.request("trunks.template.create", { templateId: engineCopy.id, ...(timezone ? { timezone } : {}) });
      const outcome = readOutcome(template.name, result);
      if (!outcome.agentId) return { made: out, error: `Couldn’t make ${template.name}. The engine didn’t say which Trunk it made.` };
      out.push({ templateId: id, agentId: outcome.agentId, name: outcome.name });
    } catch (e) {
      return { made: out, error: `Couldn’t make ${template.name}. ${errorText(e)}` };
    }
  }
  return { made: out, error: null };
}

/** The setup record (wizard.*), so the card doesn't open by itself again; written on Meet them and on Set up later. */
export async function recordOnboarding(engine: WindowEngine, s: OnboardingState): Promise<void> {
  await recordSetup(engine, { ...freshChoices("system"), promise: true, where: "this", modelsOff: s.off, jobs: [] }, "", null);
}

/** Set up by talking (HANDOFF R1-07): the conversation's name and the first message, which asks the card's questions. */
export const TALK_TITLE = "Setting up Branch";
export const TALK_MESSAGE = "Help me set up Branch by asking me these one at a time, and wait for each answer: which of my models to use, how much you may do on your own (Ask first, Auto or Read only), what my first Trunk should take off my plate, and where I want to reach you. Start with the first question.";

/** Starts "Setting up Branch" with the default Trunk (sessions.create with its first message); returns its key. */
export async function startSetupTalk(engine: WindowEngine): Promise<string> {
  const def = readDefaultTrunk(await engine.request("agents.list", {}).catch(() => null));
  const result = await engine.request("sessions.create", { ...(def ? { agentId: def.id } : {}), displayName: TALK_TITLE, message: TALK_MESSAGE });
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  if (typeof r.key !== "string" || !r.key) throw new Error("The engine didn’t start the conversation.");
  return r.key;
}

/** The signed-in profile id from users.self, or "" when this connection has no profile. */
export function profileIdOf(value: unknown): string {
  const profile = value && typeof value === "object" ? (value as { profile?: { id?: unknown } }).profile : undefined;
  return typeof profile?.id === "string" ? profile.id : "";
}

/** Saves the name where Settings › People keeps it (users.setDisplayName). No profile means nothing to write. */
export async function saveDisplayName(engine: WindowEngine, name: string): Promise<void> {
  const displayName = name.trim();
  if (!displayName) return;
  const profileId = profileIdOf(await engine.request("users.self", {}));
  if (!profileId) return;
  await engine.request("users.setDisplayName", { profileId, displayName });
}

/** Sends the first message into the Trunk's main conversation and returns that conversation's key. */
export async function greet(engine: WindowEngine, agentId: string, mainKey: string, name = ""): Promise<string> {
  const sessionKey = mainSessionOf(agentId, mainKey);
  const result = await engine.request("chat.send", { sessionKey, message: greeting(name), idempotencyKey: crypto.randomUUID() });
  // chat.send can refuse without throwing ({status: "error", error}), as RunCard reads it; that is a failure too.
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  if (r.status === "error") throw new Error(typeof r.error === "string" && r.error ? r.error : "The first message was rejected.");
  return sessionKey;
}
