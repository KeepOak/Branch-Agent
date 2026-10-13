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
import { carried, GREETING, mainSessionOf, ownerTimeZone, type OnboardingState } from "./model";

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
  const identity = row.identity && typeof row.identity === "object" ? (row.identity as Record<string, unknown>) : {};
  return { id, name: str(identity.name) || str(row.name) || id, mainKey: str(v.mainKey) || "main" };
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

/** Sends the first message into the Trunk's main conversation and returns that conversation's key. */
export async function greet(engine: WindowEngine, agentId: string, mainKey: string): Promise<string> {
  const sessionKey = mainSessionOf(agentId, mainKey);
  await engine.request("chat.send", { sessionKey, message: GREETING, idempotencyKey: crypto.randomUUID() });
  return sessionKey;
}
