// The open conversation as a room (DESIGN-SPEC §4.2.4), read from the engine through WindowEngine:
// - users.self: the viewer's profile, so their own messages stay on the right;
// - sessions.describe: the row's kind, chatType and participants (refreshed on sessions.changed for this key);
// - config.get: channels.a2a.peers[<name>].url, whose host is where an A2A agent runs (tokens are never read out).
// "Who answers" in a chat-app group is the session's groupActivation (sessions.patch; "mention" or "always").
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { describeMembers, isChatAppGroup, isRoom, NO_MEMBERS, readParticipants, withSenders, type Members } from "./members";
import { A2A_CHANNEL } from "./sender";

export type Rule = "mention" | "always";
export const RULE_WORDS: Record<Rule | "lead", string> = { mention: "mentions only", always: "everyone answers", lead: "lead decides" };

export type Room = {
  isRoom: boolean;
  /** A chat-app group, where the engine's groupActivation decides who answers. */
  chatApp: boolean;
  /** The viewer's profile id: null with no signed-in person, undefined while it is read. */
  selfId: string | null | undefined;
  ownAgentId?: string;
  members: Members;
  /** Where an A2A agent runs (its peer address's host), or null when the engine has no address for it. */
  whereRuns: (peer: string) => string | null;
  /** Whether an outside agent is connected now (the green dot on its face). */
  isOnline: (peer: string) => boolean;
  /** Who answers, once this window set it: the engine doesn't report the current value yet. */
  rule: Rule | null;
  setRule: (rule: Rule) => Promise<void>;
  /** "<description> · <rule>" for the header's state line. */
  line: (ownTrunk: string, trunkName: (agentId: string) => string) => string;
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The host of each A2A peer's address (config channels.a2a.peers). */
export function readPeerHosts(config: unknown): Record<string, string> {
  const peers = rec(rec(rec(rec(config).channels)[A2A_CHANNEL]).peers);
  const out: Record<string, string> = {};
  for (const [name, peer] of Object.entries(peers)) {
    try {
      const url = str(rec(peer).url);
      if (url) out[name] = new URL(url).host;
    } catch {
      // not an address: no place to show
    }
  }
  return out;
}

function useSelf(engine: WindowEngine | undefined): string | null | undefined {
  const [self, setSelf] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!engine) return;
    let live = true;
    engine.request("users.self", {}).then(
      (r) => live && setSelf(str(rec(rec(r).profile).id) || null),
      () => live && setSelf(null),
    );
    return () => {
      live = false;
    };
  }, [engine]);
  return self;
}

function useDescribe(engine: WindowEngine | undefined, key: string | null): unknown {
  const [session, setSession] = useState<unknown>(null);
  useEffect(() => {
    setSession(null);
    if (!engine || !key) return;
    let live = true;
    const read = () => engine.request("sessions.describe", { key }).then((r) => live && setSession(rec(r).session ?? null), () => undefined);
    void read();
    const off = engine.onEvent((e) => {
      if (e.event === "sessions.changed" && str(rec(e.payload).sessionKey) === key) void read();
    });
    return () => {
      live = false;
      off();
    };
  }, [engine, key]);
  return session;
}

/** Where each outside agent runs, and which are online: configured A2A peers' hosts (config.get) and the
 *  engine's peer list (a2a.peers.list), which also carries agents connected through `branch mcp serve`. */
export function readPeerList(result: unknown): { hosts: Record<string, string>; online: string[] } {
  const peers = Array.isArray(rec(result).peers) ? (rec(result).peers as unknown[]) : [];
  const hosts: Record<string, string> = {};
  const online: string[] = [];
  for (const peer of peers.map(rec)) {
    const name = str(peer.name);
    if (!name) continue;
    if (str(peer.where)) hosts[name] = str(peer.where);
    if (peer.online === true) online.push(name);
  }
  return { hosts, online };
}

function usePeerHosts(engine: WindowEngine | undefined, wanted: boolean): { hosts: Record<string, string>; online: string[] } {
  const [peers, setPeers] = useState<{ hosts: Record<string, string>; online: string[] }>({ hosts: {}, online: [] });
  useEffect(() => {
    if (!engine || !wanted) return;
    let live = true;
    Promise.all([
      engine.request("config.get", {}).then((r) => readPeerHosts(rec(r).config), () => ({})),
      engine.request("a2a.peers.list", {}).then(readPeerList, () => ({ hosts: {}, online: [] })),
    ]).then(([configured, listed]) => {
      if (live) setPeers({ hosts: { ...listed.hosts, ...configured }, online: listed.online });
    });
    return () => {
      live = false;
    };
  }, [engine, wanted]);
  return peers;
}

export function useRoom(engine: WindowEngine | undefined, rowKind: string | undefined, history: readonly Block[]): Room {
  const key = engine?.sessionKey ?? null;
  const ownAgentId = engine?.agentId;
  const selfId = useSelf(engine);
  const session = useDescribe(engine, key);
  const [rules, setRules] = useState<Record<string, Rule>>({});
  const participants = useMemo(() => (session ? readParticipants(session, ownAgentId, selfId) : NO_MEMBERS), [session, ownAgentId, selfId]);
  const members = useMemo(() => withSenders(participants, history, ownAgentId, selfId), [participants, history, ownAgentId, selfId]);
  const peers = usePeerHosts(engine, members.agents.length > 0);
  const rule = key ? rules[key] ?? null : null;
  const setRule = useCallback(
    async (next: Rule) => {
      if (!engine || !key) return;
      await engine.request("sessions.patch", { key, ...(ownAgentId ? { agentId: ownAgentId } : {}), groupActivation: next });
      setRules((cur) => ({ ...cur, [key]: next }));
    },
    [engine, key, ownAgentId],
  );
  return {
    isRoom: isRoom(session, rowKind, participants),
    chatApp: isChatAppGroup(session, rowKind),
    selfId,
    ownAgentId,
    members,
    whereRuns: (peer) => peers.hosts[peer] ?? null,
    isOnline: (peer) => peers.online.includes(peer),
    rule,
    setRule,
    line: (ownTrunk, trunkName) => {
      const text = describeMembers(members, ownTrunk, trunkName);
      return rule ? `${text} · ${RULE_WORDS[rule]}` : text;
    },
  };
}
