// Settings › Chat apps (DESIGN-SPEC §4.7.10): the connected chat apps with their live health (channels.status,
// read again on each engine health update), people asking to message (channels.pairing.*), who answers in each
// app and chat (bindings), each app's Manage dialog, connecting another through the engine's channel-setup wizard,
// and at Advanced and Technical every chat-app setting the engine has (config.patch), greyed where it has none.
import { useCallback, useEffect, useRef, useState } from "react";
import type { SettingsPageProps } from "../index";
import type { WindowEngine } from "../../../connect/engine";
import { errorText, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Acts, Btn, Empty, Page, Pill, Plist, Prow, Status, useConfig, useLevel, type Lv, type RowEntry } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import { catalogue, connectedApps, appOf, trunksOf, type App, type CatalogueApp, type ChannelsStatus } from "./chatapps-data";
import { rowsOf, TableSec, type Cfg } from "./chatapps-kit";
import { ADVANCED, DEPTH, LATER, TECH_A } from "./chatapps-tables";
import { Asking, type Filter, type Pairing } from "./chatapps-asking";
import { appRoute, bindingsOf, WhoAnswers } from "./chatapps-who";
import { ManageDialog } from "./chatapps-manage";
import { AllAppsDialog, ConnectDialog } from "./chatapps-connect";
import { partFor } from "./chatapps-parts";
import { peoplePart } from "./chatapps-people";
import { Lists } from "./chatapps-lists";
import { Depth, DEPTH_TITLES, MSG_KEY_TITLES, MsgKeys } from "./chatapps-depth";
import "./set1.css";
import "./chatapps.css";

/** A read that keeps showing the last answer while it reads again, and reads again on each engine health update. */
function useLive<T>(engine: WindowEngine, method: string, params: unknown) {
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: string }>({ loading: true });
  const gen = useRef(0);
  const last = useRef(0);
  const key = JSON.stringify(params);
  const reload = useCallback(async () => {
    const g = ++gen.current;
    last.current = Date.now();
    try { const data = await engine.request<T>(method, JSON.parse(key)); if (g === gen.current) setState({ data, loading: false }); }
    catch (e) { if (g === gen.current) setState((s) => ({ ...s, loading: false, error: errorText(e) })); }
  }, [engine, method, key]);
  useEffect(() => { void reload(); return () => { gen.current++; }; }, [reload]);
  useEffect(() => engine.onEvent((e) => { if (e.event === "health" && Date.now() - last.current > 10000) void reload(); }), [engine, reload]);
  return { ...state, reload };
}

type Open = { manage?: string; connect?: CatalogueApp | null; all?: boolean };

export function ChatAppsPage(props: SettingsPageProps) {
  const level = useLevel();
  const status = useLive<ChannelsStatus>(props.engine, "channels.status", {});
  const pairing = useLive<Pairing>(props.engine, "channels.pairing.list", {});
  const agents = useResource<RecordValue>(props.engine, "agents.list", {});
  const config = useConfig(props.engine);
  const cfg: Cfg = { get: config.get, set: config.set, loading: config.loading };
  const [open, setOpen] = useState<Open>({});
  const [filter, setFilter] = useState<Filter>({ app: "", acct: "" });
  const apps = connectedApps(status.data);
  const all = catalogue(status.data);
  const { trunks, defaultId } = trunksOf(agents.data);
  const trunkFor = (ch: string) => { const id = appRoute(bindingsOf(cfg), ch) ?? defaultId; return trunks.find((t) => t.id === id)?.name ?? "your Trunk"; };
  const reloadAll = async () => { await Promise.all([status.reload(), pairing.reload()]); };
  const managed = open.manage ? apps.find((a) => a.id === open.manage) ?? (status.data ? appOf(status.data, all.find((c) => c.id === open.manage) ?? { id: open.manage, name: open.manage, detail: "" }) : undefined) : undefined;
  const jump = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 0);
  return (
    <Page title={props.title} lede="Where you can message your Trunks, and how each chat app behaves.">
      <Connected loading={status.loading && !status.data} error={status.error} apps={apps} count={all.length} onOpen={(id) => setOpen({ manage: id })} onAll={() => setOpen({ all: true })} onConnect={() => setOpen({ connect: null })} />
      <Asking engine={props.engine} apps={apps} pairing={pairing.data} error={pairing.error} reload={pairing.reload} filter={filter} setFilter={setFilter} trunkFor={trunkFor} />
      <WhoAnswers engine={props.engine} apps={apps} cfg={cfg} trunks={trunks} defaultId={defaultId} />
      {apps.length > 0 && level >= 1 ? <More level={level} cfg={cfg} apps={apps} all={all} trunks={trunks} engine={props.engine} /> : null}
      {managed ? <ManageDialog engine={props.engine} app={managed} cfg={cfg} trunks={trunks} defaultId={defaultId} pairing={pairing.data} reload={reloadAll}
        onReview={(app, acct) => { setFilter({ app, acct }); setOpen({}); jump("chatapps-asking"); }} onPerChat={() => { setOpen({}); jump("chatapps-who"); }}
        onSetup={() => setOpen({ connect: managed })} onClose={() => setOpen({})} /> : null}
      {open.all ? <AllAppsDialog apps={all.map((c) => apps.find((a) => a.id === c.id) ?? c)} onOpen={(id) => setOpen({ manage: id })} onConnect={(c) => setOpen({ connect: c })} onClose={() => setOpen({})} /> : null}
      {open.connect !== undefined ? <ConnectDialog engine={props.engine} app={open.connect} onClose={(changed) => { setOpen({}); if (changed) void reloadAll(); }} /> : null}
    </Page>
  );
}

type ConnectedProps = { loading: boolean; error?: string; apps: App[]; count: number; onOpen: (id: string) => void; onAll: () => void; onConnect: () => void };
function Connected({ loading, error, apps, count, onOpen, onAll, onConnect }: ConnectedProps) {
  if (loading) return <Status tone="idle" title="Reading your chat apps…" />;
  return (
    <>
      {error ? <Status tone="bad" title="Branch couldn’t read your chat apps">{visible(error)}</Status> : null}
      {apps.length ? (
        <Plist>{apps.map((a) => (
          <Prow key={a.id} icon={<Logo id={a.id} name={a.name} size={32} />} title={a.name} sub={a.sub}>
            <Pill tone={a.tone === "ok" ? "ok" : a.tone === "work" ? "work" : "bad"}>{a.word}</Pill>
            <Btn sm onClick={() => onOpen(a.id)}>Open</Btn>
          </Prow>
        ))}</Plist>
      ) : error ? null : <Empty>No chat app is connected yet. Message your Trunks from Telegram, WhatsApp, Slack… Connect one to get started.</Empty>}
      <Acts><Btn pri onClick={onConnect}>Connect a chat app</Btn>{count > 0 ? <Btn onClick={onAll}>{`All ${count} chat apps`}</Btn> : null}</Acts>
    </>
  );
}

type MoreProps = { level: Lv; cfg: Cfg; apps: App[]; all: CatalogueApp[]; trunks: { id: string; name: string }[]; engine: WindowEngine };
/** Advanced and Technical: the tables in the preview's order, with the rows that read engine data drawn by id. */
function More({ level, cfg, apps, all, trunks, engine }: MoreProps) {
  const custom = (id: string, row: { t: string; sub?: string } & RecordValue) => {
    if (id === "lists") return <Lists apps={apps} cfg={cfg} />;
    if (id === "msgKeys") return <MsgKeys cfg={cfg} />;
    if (id === "depth") return <Depth catalogue={all} connected={new Set(apps.map((a) => a.id))} cfg={cfg} />;
    return peoplePart(id, { apps, cfg, trunks }) ?? partFor(id, { apps, cfg, all, engine }, row as never);
  };
  const secs = [...ADVANCED, ...(level >= 2 ? TECH_A : []), DEPTH, ...LATER];
  return <>{secs.filter((s) => s.lv <= level).map((s) => <TableSec key={s.title} sec={s} cfg={cfg} level={level} custom={custom} />)}</>;
}

/** Every row title, for the settings search. */
export const CHATAPPS_ROWS: RowEntry[] = [
  { page: "chatapps", title: "Asking to message", sec: "Asking to message", group: "Asking to message", lv: 0, words: "pairing approve dismiss requests" },
  { page: "chatapps", title: "Allow by code", sec: "Asking to message", group: "Asking to message", lv: 0 },
  { page: "chatapps", title: "Who answers", sec: "Who answers", group: "Who answers", lv: 0, words: "routing trunk per chat" },
  ...rowsOf("chatapps", [...ADVANCED, ...TECH_A, ...LATER].map((s) => ({ ...s, rows: s.rows.filter((r) => r.kind !== "custom" || !["cmdRows", "watchdog", "formatting", "queueByApp", "lists", "actions", "msgKeys", "delayMin", "delayMax", "apprWhere"].includes(r.id ?? "")) }))),
  ...["/new and /stop", "/model", "/config", "/approve"].map((t) => ({ page: "chatapps", title: t, sec: "Commands in chat apps", group: "Commands", lv: 1 as Lv, words: "who may use command" })),
  ...DEPTH_TITLES.map((t) => ({ page: "chatapps", title: t, sec: DEPTH.title, group: DEPTH.group ?? DEPTH.title, lv: 1 as Lv })),
  ...MSG_KEY_TITLES.map((t) => ({ page: "chatapps", title: t, sec: "Messages, every setting", group: "Messages", lv: 2 as Lv })),
];
