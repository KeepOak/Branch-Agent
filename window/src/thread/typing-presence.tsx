import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { RoomAvatar } from "../rooms/RoomMessage";
import { Typing } from "./blocks";

type Actor = { id: string; label?: string; avatarUrl?: string };
type Profile = { id: string; displayName?: string | null; hasAvatar?: boolean; updatedAt?: number; githubIdentity?: { avatarUrl?: string } | null };
type Target = { sessionId?: string; key?: string };

/** Existing gateway typing protocol: scope by conversation generation, hide self, expire silence. */
export function PeerTyping({ engine }: { engine?: WindowEngine }) {
  const [actors, setActors] = useState<Actor[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  useEffect(() => {
    setActors([]);
    setProfiles([]);
    if (!engine?.sessionKey) return;
    let live = true;
    let target: Target | undefined;
    let self: string | undefined;
    void engine.request<{ profiles?: Profile[] }>("users.list", {}).then((result) => {
      if (live) setProfiles(result.profiles ?? []);
    }).catch(() => undefined);
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    void Promise.all([
      engine.request<{ session?: Target }>("sessions.describe", { key: engine.sessionKey }),
      engine.request<{ profile?: { id?: string } }>("users.self", {}),
    ]).then(([description, user]) => {
      if (live) { target = description.session; self = user.profile?.id; }
    }).catch(() => undefined);
    const remove = (id: string) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      setActors((before) => before.filter((actor) => actor.id !== id));
    };
    const off = engine.onEvent(({ event, payload }) => {
      if (event !== "session.typing" || !payload || typeof payload !== "object") return;
      const p = payload as { sessionKey?: string; sessionId?: string; actor?: Actor; typing?: boolean };
      if (!target?.sessionId || p.sessionId !== target.sessionId || (p.sessionKey !== engine.sessionKey && p.sessionKey !== target.key) || !p.actor?.id || p.actor.id === self) return;
      const actor = p.actor;
      clearTimeout(timers.get(actor.id));
      if (!p.typing) { remove(actor.id); return; }
      setActors((before) => [...before.filter((item) => item.id !== actor.id), actor]);
      timers.set(actor.id, setTimeout(() => remove(actor.id), 2500));
    });
    return () => { live = false; off(); timers.forEach(clearTimeout); };
  }, [engine]);
  return actors.map((actor) => {
    const profile = profiles.find((person) => person.id === actor.id);
    const name = actor.label || profile?.displayName || "Someone";
    const avatar = profile?.hasAvatar ? `/api/users/${encodeURIComponent(actor.id)}/avatar?v=${profile.updatedAt ?? 0}` : profile?.githubIdentity?.avatarUrl;
    return <Typing key={actor.id} name={name} face={<RoomAvatar id={actor.id} name={name} src={actor.avatarUrl ?? avatar} size={28} />} />;
  });
}

/** Publish activity, never draft contents. Reuse the server's one-second typing cadence. */
export function usePublishTyping(engine?: WindowEngine) {
  const changed = useRef<(typing: boolean) => void>(() => {});
  useEffect(() => {
    if (!engine?.sessionKey) return;
    let live = true;
    let sessionId: string | undefined;
    let last = 0;
    let active = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    void engine.request<{ session?: Target }>("sessions.describe", { key: engine.sessionKey }).then((r) => {
      if (live) sessionId = r.session?.sessionId;
    }).catch(() => undefined);
    const send = (typing: boolean) => {
      if (!sessionId) return;
      active = typing;
      last = Date.now();
      void engine.request("session.typing", { sessionKey: engine.sessionKey, sessionId, typing }).catch(() => undefined);
    };
    changed.current = (typing) => {
      clearTimeout(timeout);
      if (!typing) { if (active) send(false); return; }
      if (!active || Date.now() - last >= 1000) send(true);
      timeout = setTimeout(() => { if (active) send(false); }, 2000);
    };
    return () => { live = false; clearTimeout(timeout); if (active) send(false); changed.current = () => {}; };
  }, [engine]);
  return useCallback((typing: boolean) => changed.current(typing), []);
}
