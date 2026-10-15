// Everything R1-05 shows outside the conversation that asks: the Lockdown notice under the header, the Live-Activity
// drop while a conversation is on screen, and banners with Yes / No / Open elsewhere in the app. The conversation that
// asks shows its own card (AskCard through the thread's renderApproval slot), so it is left out here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { availability, requestOrComing } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Icon } from "../../shell/icons";
import { LOCKDOWN_WHY } from "./AskCard";
import { AskDrop } from "./AskDrop";
import { Banners, type BannerItem } from "./Banners";
import { RESOLVE_OF } from "./model";
import type { MoreBanners } from "./ProblemBanners";
import { useAsks, useLockdown } from "./useAsks";

export const LOCKDOWN_LINE = "Lockdown is on. Trunks can read, but nothing leaves this computer and nothing is changed.";

/** The red-tinted notice line under the header (preview lockBanner), in the conversation column when there is one. */
export function LockNotice({ onTurnOff }: { onTurnOff: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector(".r1-conversation") ?? document.body), []);
  if (!host) return null;
  return createPortal(
    <div className="r1-lock" role="status" data-testid="r1-lock">
      <Icon name="shield" /><span>{error ?? LOCKDOWN_LINE}</span>
      <Coming need="config.patch" reason="Turning Lockdown off here comes in a later update.">
        <button type="button" onClick={() => { setError(null); Promise.resolve(onTurnOff()).catch((e: unknown) => setError(`Lockdown is still on: ${e instanceof Error ? e.message : String(e)}`)); }}>Turn it off</button>
      </Coming>
    </div>,
    host,
  );
}

/** Trunk names for "Ledger needs you", read from agents.list once something waits (identity.name, as
 *  shell/engine-data readTrunks reads it; that module pulls in the connection, so the reader is repeated here). */
const namesOf = (result: unknown): Map<string, string> => {
  const agents = (result as { agents?: unknown } | null)?.agents;
  return new Map((Array.isArray(agents) ? agents : []).flatMap((a: { id?: unknown; name?: unknown; identity?: { name?: unknown } }) => {
    const id = typeof a?.id === "string" ? a.id : "";
    const name = typeof a?.identity?.name === "string" && a.identity.name ? a.identity.name : typeof a?.name === "string" && a.name ? a.name : id;
    return id ? [[id, name] as [string, string]] : [];
  }));
};
function useTrunkNames(engine: WindowEngine | null, needed: boolean): (agentId?: string) => string {
  const [names, setNames] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    if (!engine || !needed || names || availability(engine, "agents.list") === "no") return;
    let live = true;
    requestOrComing(engine, "agents.list", {}).then((r) => {
      if (live) setNames(namesOf(r));
    }, () => undefined);
    return () => { live = false; };
  }, [engine, needed, names]);
  return useCallback((agentId?: string) => (agentId && names?.get(agentId)) || "Your Trunk", [names]);
}

type LayerProps = {
  engine: WindowEngine | null;
  ready?: boolean;
  /** The conversation on screen; its approvals show as cards in the thread. */
  sessionKey: string | null;
  /** "chat" while a conversation is on screen (the drop); anything else gets banners. */
  view: "chat" | "other";
  nameOf?: (agentId?: string) => string;
  onOpen: (sessionKey: string) => void;
  /** Problem and news banners (ProblemBanners.tsx), drawn on top of the same stack in every view. */
  more?: MoreBanners;
};

export function ApprovalsLayer({ engine, ready = true, sessionKey, view, nameOf: given, onOpen, more }: LayerProps) {
  const lock = useLockdown(engine, ready);
  const { waiting, answer } = useAsks(ready ? engine : null, lock.on);
  const away = waiting.filter((s) => !sessionKey || s.ask.sessionKey !== sessionKey);
  const looked = useTrunkNames(ready ? engine : null, !given && away.length > 0);
  const nameOf = given ?? looked;
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const dismissAsk = useCallback((id: string) => setDismissed((d) => new Set(d).add(id)), []);
  const moreDismiss = more?.dismiss;
  const dismiss = useCallback((id: string) => { dismissAsk(id); moreDismiss?.(id); }, [dismissAsk, moreDismiss]);
  const banners: BannerItem[] = useMemo(() => away.filter((s) => s.live && s.status === "waiting" && !dismissed.has(s.ask.id)).reverse().map(({ ask }) => ({
    id: ask.id,
    title: `${nameOf(ask.agentId)} needs you`,
    body: ask.title,
    actions: <>
      {ask.kind !== "question" && ask.allowed.includes("allow-once") ? <Coming need={RESOLVE_OF[ask.kind]}><button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" disabled={lock.on} title={lock.on ? LOCKDOWN_WHY : undefined} onClick={() => { void answer(ask.id, "allow-once"); dismiss(ask.id); }}>Yes</button></Coming> : null}
      {ask.kind !== "question" ? <Coming need={RESOLVE_OF[ask.kind]}><button type="button" className="r1-ask-btn" onClick={() => { void answer(ask.id, "deny"); dismiss(ask.id); }}>No</button></Coming> : null}
      {ask.sessionKey ? <button type="button" className="r1-ask-btn" data-kind="ghost" data-local onClick={() => { dismiss(ask.id); onOpen(ask.sessionKey!); }}>Open</button> : null}
    </>,
  })), [away, dismissed, nameOf, lock.on, answer, dismiss, onOpen]);
  const extra = more?.items;
  const stack = useMemo(() => [...(extra ?? []), ...(view === "chat" ? [] : banners)], [extra, view, banners]);
  return <>
    {lock.on ? <LockNotice onTurnOff={lock.turnOff} /> : null}
    {view === "chat" ? <AskDrop waiting={away} nameOf={nameOf} onAnswer={(id, reply) => void answer(id, reply)} onOpen={onOpen} lockdown={lock.on} /> : null}
    <Banners items={stack} onDismiss={dismiss} />
  </>;
}
