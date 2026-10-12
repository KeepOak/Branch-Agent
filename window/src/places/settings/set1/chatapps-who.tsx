// Settings › Chat apps › Who answers (§4.7.10): which Trunk answers in each app and in each chat, as the engine's
// route bindings (bindings[]: match.channel with accountId "*" for the whole app, plus match.peer for one chat).
// The bindings list is read, changed at its one entry and written back whole, so other routes are kept. The chats
// come from the engine's conversations (sessions.list); a chat's own model is channels.modelByChannel.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { Menu, type MenuAnchor } from "../../../shell/Menu";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Ctl, Hint, Pick, Seg, useLevel } from "../kit";
import type { App, Trunk } from "./chatapps-data";
import type { Cfg } from "./chatapps-kit";

export type Peer = { kind: "direct" | "group" | "channel"; id: string };
export type Binding = { type?: string; agentId: string; match: { channel: string; accountId?: string; peer?: Peer; guildId?: string; teamId?: string; roles?: string[] } } & RecordValue;
export type Chat = { peer: Peer; name: string; kind: string };

const isRoute = (b: Binding) => b.type === undefined || b.type === "route";
const appLevel = (b: Binding, ch: string) => isRoute(b) && b.match?.channel === ch && !b.match.peer && !b.match.guildId && !b.match.teamId && !b.match.roles?.length && (b.match.accountId === "*" || !b.match.accountId);
const chatLevel = (b: Binding, ch: string, p: Peer) => isRoute(b) && b.match?.channel === ch && b.match.peer?.kind === p.kind && b.match.peer.id === p.id;

export const bindingsOf = (cfg: Cfg) => list(cfg.get("bindings")) as unknown as Binding[];
/** The Trunk the whole app goes to (its "*" route first), if one is set. */
export function appRoute(bs: Binding[], ch: string): string | undefined {
  return (bs.find((b) => appLevel(b, ch) && b.match.accountId === "*") ?? bs.find((b) => appLevel(b, ch)))?.agentId;
}
export const chatRoute = (bs: Binding[], ch: string, p: Peer) => bs.find((b) => chatLevel(b, ch, p))?.agentId;

/** The bindings with this app's (or chat's) route replaced; null removes it, so the default answers. */
export function withRoute(bs: Binding[], ch: string, peer: Peer | null, agentId: string | null): Binding[] {
  const kept = bs.filter((b) => !(peer ? chatLevel(b, ch, peer) : appLevel(b, ch)));
  if (!agentId) return kept;
  return [...kept, { agentId, match: { channel: ch, accountId: "*", ...(peer ? { peer } : {}) } }];
}

const KIND_WORD: Record<Peer["kind"], string> = { direct: "Direct message", group: "Group", channel: "Channel" };
/** The app's chats: group and channel ids from the conversation keys, direct chats only where the engine names the person. */
export function chatsOf(rows: RecordValue[], bs: Binding[], ch: string): Chat[] {
  const out = new Map<string, Chat>();
  for (const r of rows) {
    const o = record(r.origin);
    const parts = text(r.key).split(":");
    const at = parts.findIndex((p, i) => i > 1 && (p === "group" || p === "channel") && parts.slice(0, i).includes(ch));
    const peer: Peer | null = at > 0 ? { kind: parts[at] as Peer["kind"], id: parts.slice(at + 1).join(":") }
      : o.provider === ch && o.chatType === "direct" && typeof o.nativeDirectUserId === "string" ? { kind: "direct", id: o.nativeDirectUserId } : null;
    if (!peer || !peer.id || out.has(`${peer.kind}:${peer.id}`)) continue;
    const name = visible(r.displayName ?? r.subject ?? o.label ?? peer.id);
    out.set(`${peer.kind}:${peer.id}`, { peer, name, kind: peer.id.includes(":topic:") ? "Topic" : KIND_WORD[peer.kind] });
  }
  for (const b of bs) { const p = b.match?.peer; if (isRoute(b) && b.match.channel === ch && p && !out.has(`${p.kind}:${p.id}`)) out.set(`${p.kind}:${p.id}`, { peer: p, name: p.id, kind: KIND_WORD[p.kind] }); }
  return [...out.values()];
}

type Props = { engine: WindowEngine; apps: App[]; cfg: Cfg; trunks: Trunk[]; defaultId: string };

export function WhoAnswers({ engine, apps, cfg, trunks, defaultId }: Props) {
  const sessions = useResource<RecordValue>(engine, "sessions.list", { limit: 500, requireLastInteraction: true, excludeSubagents: true, excludeCron: true, excludeSystem: true });
  if (!apps.length) return null;
  const bs = bindingsOf(cfg);
  const rows = list(sessions.data?.sessions);
  return (
    <div className="sec" data-sec="Who answers" id="chatapps-who">
      <h2>Who answers</h2>
      <Hint>A chat’s own choice wins over its app’s; a topic’s wins over its group’s.</Hint>
      {apps.map((a) => <AppRoutes key={a.id} engine={engine} app={a} cfg={cfg} bs={bs} chats={chatsOf(rows, bs, a.id)} trunks={trunks} defaultId={defaultId} />)}
    </div>
  );
}

export function WhoSeg({ app, cfg, trunks, defaultId }: { app: { id: string; name: string }; cfg: Cfg; trunks: Trunk[]; defaultId: string }) {
  const bs = bindingsOf(cfg);
  const who = appRoute(bs, app.id) ?? defaultId;
  const set = (id: string) => { const next = withRoute(bs, app.id, null, id === defaultId ? null : id); void cfg.set("bindings", next.length ? next : null); };
  return <Seg label={`Who answers in ${app.name}`} value={who} options={trunks.map((t) => ({ id: t.id, label: t.name }))} disabled={cfg.loading} onChange={set} />;
}

function AppRoutes({ engine, app, cfg, bs, chats, trunks, defaultId }: { engine: WindowEngine; app: App; cfg: Cfg; bs: Binding[]; chats: Chat[]; trunks: Trunk[]; defaultId: string }) {
  const level = useLevel();
  const appWho = trunks.find((t) => t.id === (appRoute(bs, app.id) ?? defaultId))?.name ?? "the default Trunk";
  const models = record(record(cfg.get("channels.modelByChannel"))[app.id]);
  return (
    <>
      <Ctl title={`Who answers in ${app.name}`} sub={`Every chat that follows “As ${app.name}” goes here, one continuous conversation per chat. /new in a chat starts a fresh one.`}>
        <WhoSeg app={app} cfg={cfg} trunks={trunks} defaultId={defaultId} />
      </Ctl>
      {chats.map((c) => {
        const set = (v: string) => { const next = withRoute(bs, app.id, c.peer, v === "app" ? null : v); void cfg.set("bindings", next.length ? next : null); };
        const model = typeof models[c.peer.id] === "string" ? visible(models[c.peer.id]) : "";
        return (
          <Ctl key={`${c.peer.kind}:${c.peer.id}`} id={c.name} title={c.name} sub={model ? `${c.kind} · ${model}` : c.kind}>
            <Pick label={`Who answers in ${c.name}`} value={chatRoute(bs, app.id, c.peer) ?? "app"} disabled={cfg.loading} onChange={set} options={[{ id: "app", label: `As ${app.name} (${appWho})` }, ...trunks.map((t) => ({ id: t.id, label: t.name }))]} />
            {level >= 1 ? <ChatMore engine={engine} app={app} chat={c} cfg={cfg} models={models} /> : null}
          </Ctl>
        );
      })}
    </>
  );
}

const MORE = <svg className="i s" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></svg>;
/** ⋯ for one chat: another model there (channels.modelByChannel.<app>.<chat id>), or back to the Trunk's. */
function ChatMore({ engine, app, chat, cfg, models }: { engine: WindowEngine; app: App; chat: Chat; cfg: Cfg; models: RecordValue }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [pick, setPick] = useState(false);
  const put = (ref: string | null) => { const next = { ...models }; if (ref) next[chat.peer.id] = ref; else delete next[chat.peer.id]; void cfg.set(`channels.modelByChannel.${app.id}`, Object.keys(next).length ? next : null); };
  return (
    <>
      <button type="button" className="icon-btn" aria-label={`More for ${chat.name}`} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right - 220, y: r.bottom + 4 }); }}>{MORE}</button>
      {menu ? <Menu at={menu} label={chat.name} onClose={() => setMenu(null)} items={[{ label: "Use another model here", run: () => setPick(true) }, ...(models[chat.peer.id] ? [{ label: "Use the Trunk’s model", run: () => put(null) }] : [])]} /> : null}
      {pick ? <ModelPick engine={engine} chat={chat} current={text(models[chat.peer.id] ?? "")} onPick={(ref) => { put(ref); setPick(false); }} onClose={() => setPick(false)} /> : null}
    </>
  );
}

function ModelPick({ engine, chat, current, onPick, onClose }: { engine: WindowEngine; chat: Chat; current: string; onPick: (ref: string) => void; onClose: () => void }) {
  const models = useResource<RecordValue>(engine, "models.list", {});
  const all = list(models.data?.models).map((m) => ({ ref: `${text(m.provider)}/${text(m.id)}`, name: visible(m.name ?? m.id) }));
  return (
    <Dialog title={`Model for ${chat.name}`} onClose={onClose} testid="chatapps-model" footer={<button type="button" className="btn ghost" onClick={onClose}>Cancel</button>}>
      <div className="rows">
        {all.map((m) => <button key={m.ref} type="button" className="prow pick-ca" role="menuitemradio" aria-checked={m.ref === current} onClick={() => onPick(m.ref)}><span className="grow"><b>{m.name}</b><small>{m.ref}</small></span>{m.ref === current ? "✓" : null}</button>)}
        {!models.loading && !all.length ? <p className="hint">No model is set up yet.</p> : null}
      </div>
      <p className="hint">It applies only while that conversation has not picked a model itself.</p>
    </Dialog>
  );
}
