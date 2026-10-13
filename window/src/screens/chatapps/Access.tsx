// Who answers in one chat app and in each of its chats, and who may message it (Classic chatapps-who and Manage's
// "Who may message it"): the engine's route bindings (bindings[]), each chat's own model (channels.modelByChannel), and
// channels.<id>.dmPolicy with its allowFrom. The bindings list is changed at its one entry and written back whole.
import { useMemo } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useRow, type Row } from "../settings";
import { useLevel } from "../settings/SettingsFrame";
import { useResource } from "../../places/settings/hooks";
import { list, record, text, visible, type RecordValue } from "../../places/settings/adapter";
import { appRoute, chatsOf, withRoute, type Binding, type Peer } from "../../places/settings/set1/chatapps-who";
import { trunksOf } from "../../places/settings/set1/chatapps-data";
import type { ChatApp } from "./catalogue";
import { useCfg } from "./parts";

const bindingRow: Row = { id: "chatapps.answers.bindings", page: "chatapps", card: "Who answers", level: 0, control: "custom", source: { kind: "config", path: "bindings" } };
const SESSIONS = { limit: 500, requireLastInteraction: true, excludeSubagents: true, excludeCron: true, excludeSystem: true };
/** Classic's "Who may message it" choices: Only me keeps the people named below (allowlist); workspace has no engine key. */
const WHO: { v: string; label: string }[] = [{ v: "allowlist", label: "Only me" }, { v: "pairing", label: "People I approve" }, { v: "workspace", label: "Anyone in my workspace · Coming" }, { v: "open", label: "Anyone" }, { v: "disabled", label: "No one" }];

export function Access({ engine, app }: { engine: WindowEngine; app: ChatApp }) {
  const ch = app.channel ?? app.id;
  const row = useMemo<Row>(() => ({ id: "chatapps." + app.id + ".access", page: "chatapps", card: "Who may message", level: 0, control: "custom", source: { kind: "config", path: "channels." + ch } }), [app.id, ch]);
  const access = useRow(engine, row), routes = useRow(engine, bindingRow);
  const agents = useResource<Record<string, unknown>>(engine, "agents.list");
  const sessions = useResource<RecordValue>(engine, "sessions.list", SESSIONS);
  const [level] = useLevel(engine);
  const { trunks, defaultId } = trunksOf(agents.data);
  const bindings = (Array.isArray(routes.value) ? routes.value : []) as Binding[];
  const channel = record(access.value);
  const allow = Array.isArray(channel.allowFrom) ? channel.allowFrom.map(String) : [];
  const policy = typeof channel.dmPolicy === "string" ? channel.dmPolicy : "pairing";
  const named = allow.filter((v) => v !== "*").length > 0;
  const setPolicy = (value: string) => {
    const nextAllow = value === "open" ? [...new Set([...allow, "*"])] : allow.filter(v => v !== "*");
    void access.set({ dmPolicy: value, allowFrom: nextAllow }).catch(() => undefined);
  };
  const setRoute = (peer: Peer | null, id: string | null) => { const next = withRoute(bindings, ch, peer, id); void routes.set(next.length ? next : null).catch(() => undefined); };
  const appWho = trunks.find((t) => t.id === (appRoute(bindings, ch) ?? defaultId))?.name ?? "the default Trunk";
  const chats = chatsOf(list(sessions.data?.sessions), bindings, ch);
  return <section className="r1-ca-access" aria-label={"Access for " + app.name}>
    <label><span className="g-label">Who answers in {app.name}</span><select aria-label={"Who answers in " + app.name} disabled={routes.state !== "ready" || !trunks.length} value={appRoute(bindings, ch) ?? defaultId} data-need="config.patch agents.list" onChange={e => setRoute(null, e.target.value === defaultId ? null : e.target.value)}>{!trunks.length && <option value="">Loading Trunks…</option>}{trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    {chats.length ? <div className="r1-ca-chats" role="group" aria-label={"Chats in " + app.name}>
      <small className="g-label" data-lines>A chat’s own choice wins over its app’s; a topic’s wins over its group’s. /new in a chat starts a fresh conversation.</small>
      {chats.map((c) => {
        const chatWho = bindings.find((b) => (b.type === undefined || b.type === "route") && b.match?.channel === ch && b.match.peer?.kind === c.peer.kind && b.match.peer.id === c.peer.id)?.agentId ?? "app";
        return <div key={c.peer.kind + ":" + c.peer.id} className="r1-ca-chat">
          <span className="g-label" data-lines><b>{c.name}</b> <small>{c.kind}</small></span>
          <select aria-label={"Who answers in " + c.name} disabled={routes.state !== "ready"} value={chatWho} data-need="config.patch sessions.list" onChange={(e) => setRoute(c.peer, e.target.value === "app" ? null : e.target.value)}>
            <option value="app">As {app.name} ({appWho})</option>{trunks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {level >= 1 ? <ChatModel engine={engine} ch={ch} peerId={c.peer.id} name={c.name} /> : null}
        </div>;
      })}
    </div> : null}
    <label><span className="g-label">Who may message it</span><select aria-label={"Who may message " + app.name} disabled={access.state !== "ready"} value={policy} data-need="config.patch" onChange={e => setPolicy(e.target.value)}>
      {WHO.map((w) => <option key={w.v} value={w.v} disabled={w.v === "workspace" || (w.v === "allowlist" && !named && policy !== "allowlist")}>{w.v === "allowlist" && !named ? "Only me · add yourself in Manage first" : w.label}</option>)}
    </select></label><small className="g-label" data-lines>Everyone else gets no answer. Branch can’t tell who is in your workspace yet. Changing who may message keeps everyone already allowed. Changes save immediately.</small>
    {routes.reason && <p role="alert" className="g-label" data-lines>{routes.reason}</p>}{access.reason && <p role="alert" className="g-label" data-lines>{access.reason}</p>}{agents.error && <p role="alert" className="g-label" data-lines>{agents.error}</p>}
  </section>;
}

/** A chat's own model (channels.modelByChannel.<app>.<chat id>), or the Trunk's (Classic's ⋯ › Use another model here). */
function ChatModel({ engine, ch, peerId, name }: { engine: WindowEngine; ch: string; peerId: string; name: string }) {
  const cfg = useCfg(engine);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const own = record(record(cfg.get("channels.modelByChannel"))[ch]);
  const current = typeof own[peerId] === "string" ? String(own[peerId]) : "";
  const all = list(models.data?.models).map((m) => ({ ref: text(m.provider) + "/" + text(m.id), name: visible(m.name ?? m.id) }));
  const put = (ref: string) => { const next = { ...own }; if (ref) next[peerId] = ref; else delete next[peerId]; void cfg.set("channels.modelByChannel." + ch, Object.keys(next).length ? next : null); };
  return <select aria-label={"Model in " + name} value={current} disabled={!cfg.ready} data-need="config.patch models.list" title="It applies only while that conversation has not picked a model itself." onChange={(e) => put(e.target.value)}>
    <option value="">The Trunk’s model</option>
    {current && !all.some((m) => m.ref === current) ? <option value={current}>{visible(current)}</option> : null}
    {all.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}
  </select>;
}
