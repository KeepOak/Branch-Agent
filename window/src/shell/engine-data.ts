// What the shell reads from the engine besides the open conversation: the conversation list, the Trunks
// (agents.list), pending approvals (exec.approval.list + events) and this computer (system.info).
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ConversationList, type ConversationsSnapshot } from "../connect/conversations";
import type { SaplingSession } from "../connect/session";
import { NO_PEOPLE, type ListPeople } from "./list-model";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export type Trunk = { id: string; name: string; isDefault: boolean; avatar?: string; theme?: string; paused?: boolean };
export type Trunks = { list: Trunk[]; defaultId: string | null };

const EMPTY_LIST: ConversationsSnapshot = { rows: [], loaded: false, error: null };

export function useConversations(session: SaplingSession, ready: boolean, mainKey: string | null): [ConversationsSnapshot, ConversationList] {
  const list = useMemo(() => new ConversationList((m, p) => session.request(m, p), null), [session]);
  list.setMainKey(mainKey);
  useEffect(() => {
    if (!ready) {
      return;
    }
    void list.start();
    const off = session.onGatewayEvent((event, payload) => list.onEvent(event, payload));
    return () => {
      off();
      list.stop();
    };
  }, [list, session, ready]);
  const snap = useSyncExternalStore(list.subscribe, list.getSnapshot);
  return [ready ? snap : EMPTY_LIST, list];
}

/** The Trunks, as OpenClaw's agents.list returns them (identity.name, defaultId). */
export function readTrunks(result: unknown): Trunks {
  const r = rec(result);
  const agents = Array.isArray(r.agents) ? r.agents.map(rec) : [];
  const defaultId = str(r.defaultId) || null;
  return {
    defaultId,
    list: agents.map((a) => ({
      id: str(a.id),
      name: str(rec(a.identity).name) || str(a.name) || str(a.id),
      isDefault: str(a.id) === defaultId || a.default === true,
      avatar: str(rec(a.identity).avatar) || str(a.avatar) || undefined,
      ...(str(rec(a.identity).theme) ? { theme: str(rec(a.identity).theme) } : {}),
      ...(a.paused === true ? { paused: true } : {}),
    })),
  };
}

export function useTrunks(session: SaplingSession, ready: boolean): Trunks {
  const [trunks, setTrunks] = useState<Trunks>({ list: [], defaultId: null });
  useEffect(() => {
    if (!ready) {
      return;
    }
    const load = () =>
      session.request("agents.list", {}).then(
        (r) => setTrunks(readTrunks(r)),
        (error: unknown) => console.warn("agents.list failed", error),
      );
    void load();
    return session.onGatewayEvent((event) => {
      if (event === "agents.changed" || event === "config.changed") {
        void load();
      }
    });
  }, [session, ready]);
  return trunks;
}

/** Pending approvals by conversation key: the needs-you dots and the Inbox count. */
export function usePendingApprovals(session: SaplingSession, ready: boolean): Map<string, number> {
  const [pending, setPending] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!ready) {
      return;
    }
    const add = (item: Record<string, unknown>) =>
      setPending((m) => new Map(m).set(str(item.id), str(rec(item.request).sessionKey)));
    session.request("exec.approval.list", {}).then(
      (list) => {
        const items = Array.isArray(list) ? list : (rec(list).items ?? rec(list).approvals);
        setPending(new Map((Array.isArray(items) ? items : []).map((i) => [str(rec(i).id), str(rec(rec(i).request).sessionKey)])));
      },
      (error: unknown) => console.warn("exec.approval.list failed", error),
    );
    return session.onGatewayEvent((event, payload) => {
      if (event === "exec.approval.requested") {
        add(rec(payload));
      } else if (event === "exec.approval.resolved") {
        const id = str(rec(payload).id);
        setPending((m) => {
          const next = new Map(m);
          next.delete(id);
          return next;
        });
      }
    });
  }, [session, ready]);
  return useMemo(() => {
    const byKey = new Map<string, number>();
    for (const key of pending.values()) {
      byKey.set(key, (byKey.get(key) ?? 0) + 1);
    }
    return byKey;
  }, [pending]);
}

export type MachineInfo = { name: string; version: string };

/** This computer's name (system.info machineName) and the engine's version (hello.server.version). */
export function useMachine(session: SaplingSession, ready: boolean): MachineInfo | null {
  const [info, setInfo] = useState<MachineInfo | null>(null);
  useEffect(() => {
    if (!ready) {
      return;
    }
    const s = session.getSnapshot().status;
    const version = s.phase === "connected" ? s.hello.server.version : "";
    session.request("system.info", {}).then(
      (r) => setInfo({ name: str(rec(r).machineName) || str(rec(r).hostname), version }),
      (error: unknown) => console.warn("system.info failed", error),
    );
  }, [session, ready]);
  return info;
}

/** People for the list (§4.1.1 People filter, Group by Person): who you are (users.self) and everyone's names
 *  (users.list). A connection without a signed-in person has no self id, so "Involving me" can't show. */
export function useListPeople(session: SaplingSession, ready: boolean): ListPeople {
  const [people, setPeople] = useState<ListPeople>(NO_PEOPLE);
  useEffect(() => {
    if (!ready) {
      return;
    }
    let live = true;
    const load = () =>
      Promise.allSettled([session.request("users.self", {}), session.request("users.list", {})]).then(([self, list]) => {
        if (!live) return;
        const profiles = list.status === "fulfilled" && Array.isArray(rec(list.value).profiles) ? (rec(list.value).profiles as unknown[]).map(rec) : [];
        const names = new Map(profiles.map((p) => [str(p.id), str(p.displayName) || str(p.name) || str(p.id)] as [string, string]).filter(([id]) => id));
        const selfId = self.status === "fulfilled" ? str(rec(rec(self.value).profile).id) || null : null;
        setPeople({ selfId, names });
      });
    void load();
    const off = session.onGatewayEvent((event) => {
      if (event === "users.changed") void load();
    });
    return () => {
      live = false;
      off();
    };
  }, [session, ready]);
  return people;
}
