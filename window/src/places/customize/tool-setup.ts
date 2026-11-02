// Which built-in tools are on but cannot work yet because a provider or a sign-in is missing (Hermes A-140 and A-138
// switched on Web Search and Image Generation with no key and no badge). Read from the engine's own state, never from a
// fixed list of tool names: web search from webSearch.status (its route has no search service to use), speech from
// tts.status (no speech service is configured) and GitHub from tools.github.status (no usable credential). A tool the
// engine says nothing about never shows the badge, and a method this engine doesn't offer is never called.
import { useMemo } from "react";
import { availability } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../library/data";
import { list, rec, str } from "./common";

/** Where a tool's missing piece is set up (a Settings page id), and why it can't work yet, in plain words. */
export type Setup = { page: string; why: string };

export const WEB_SETUP: Setup = { page: "customize", why: "Web search has no search service to use yet." };
export const SPEECH_SETUP: Setup = { page: "voice", why: "Speaking aloud needs a voice service." };
export const GITHUB_SETUP: Setup = { page: "accounts", why: "GitHub isn’t signed in yet." };

/** Tool id → what it still needs, from the three status answers (null: not read, or not offered). */
export function readSetup(state: { web?: unknown; tts?: unknown; github?: unknown }): Map<string, Setup> {
  const needs = new Map<string, Setup>();
  const web = rec(state.web);
  if (state.web && web.enabled !== false && str(rec(web.route).kind) === "unavailable") needs.set("web_search", WEB_SETUP);
  const voices = list(rec(state.tts).providerStates);
  if (state.tts && voices.length && !voices.some(v => v.configured === true)) needs.set("tts", SPEECH_SETUP);
  const credential = str(rec(rec(state.github).effective).credentialState);
  if (state.github && (credential === "unavailable" || credential === "configured_unavailable")) {
    for (const id of ["github_identity_status", "github_publish"]) needs.set(id, GITHUB_SETUP);
  }
  return needs;
}

const offered = (engine: WindowEngine, method: string): string | null => (availability(engine, method) === "no" ? null : method);

/** The live answer for one Trunk (agentId), re-read when it changes. */
export function useToolSetup(engine: WindowEngine, agentId: string | null): Map<string, Setup> {
  const web = useResource<unknown>(engine, offered(engine, "webSearch.status"), agentId ? { agentId } : {});
  const tts = useResource<unknown>(engine, offered(engine, "tts.status"), {});
  const github = useResource<unknown>(engine, agentId ? offered(engine, "tools.github.status") : null, { agentId, selectedScope: "agent" });
  return useMemo(() => readSetup({ web: web.data, tts: tts.data, github: github.data }), [web.data, tts.data, github.data]);
}
