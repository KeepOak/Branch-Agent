// Settings › Computer & browser (DESIGN-SPEC §4.7.12), the top of the page: requests waiting for a yes
// (device.pair.* and node.pair.*), the computers Trunks may use (node.list, computer.status) with their ⋯ menu and
// details, and which Trunk uses which (agents.list[].tools.exec.node). The sections below those live in
// computer-more.tsx.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Hint, Page, Pill, Plist, Sec, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { Face } from "../../../face/Face";
import { Menu, type MenuItem } from "../../../shell/Menu";
import { bytes, CallLine, CopyBtn, Kv, lvOf, rec, str, Tile, useCall, useLive, when, type RecordValue } from "./common";
import { Ico } from "./icons";
import { ComputerMore, NewCloud, ROWS as MORE_ROWS } from "./computer-more";
import { Icon } from "../../../shell/icons";
import { DesktopCtl } from "../desktop-ctl";
import { shownWhy } from "../../../shell/shown-why";

const PAIR_EVENTS = ["device.pair", "node.pair", "node"];
const ALLOW_DELAY_MS = 1500;
/** Opens the computer stage on that computer (the shell switches to the open conversation). */
function watch(computerId: string): void {
  window.dispatchEvent(new CustomEvent("branch:watch-computer", { detail: { computerId } }));
}
const LEDE = "The computers your Trunks may use, and the browser they work in. Which Branch you talk to is the switcher at the top of the list.";

/** What a request asks for, in plain words; the risky ones are marked. */
const ACCESS: Record<string, string> = {
  "operator.admin": "Change Branch’s settings", "operator.write": "Send messages and run tasks", "operator.read": "See conversations",
  "operator.pairing": "Approve other devices", "operator.approvals": "Answer approvals", "system.run": "Run commands",
  "screen.record": "See the screen", "desktop.observe": "See the screen", "computer.use": "Use the mouse and keys", "camera.snap": "Use the camera",
  "camera.clip": "Use the camera", "browser.proxy": "Use a browser", "location.get": "Know where it is", "canvas.present": "Show a live panel",
};
const RISKY = new Set(["Run commands", "Change Branch’s settings"]);
const OS: Record<string, string> = { win32: "Windows", windows: "Windows", darwin: "macOS", macos: "macOS", linux: "Linux", ios: "iOS", android: "Android" };

export const ROWS: RowEntry[] = [
  ...MORE_ROWS,
  { page: "computer", title: "Waiting for your yes", group: "Waiting for your yes", lv: 0 }, { page: "computer", title: "Computers they may use", group: "Computers they may use", lv: 0 },
  { page: "computer", title: "Keep this computer awake", sec: "Computers they may use", group: "Computers they may use", lv: 0 }, { page: "computer", title: "Which Trunk uses which", group: "Which Trunk uses which", lv: 0 },
];

type Req = { id: string; kind: "device" | "node"; name: string; plat: string; access: string[]; more: boolean; ts: number; deviceId: string; ip: string; version: string };

function accessOf(words: unknown): string[] {
  return [...new Set((Array.isArray(words) ? words : []).map((w) => ACCESS[String(w)] ?? "").filter(Boolean))];
}
function osOf(platform: unknown): string { const p = str(platform); return OS[p.toLowerCase()] ?? p; }

/** Pending requests from both pairing stores, newest first. */
function requests(devices: RecordValue, nodes: RecordValue): Req[] {
  const pairedDevices = new Set(list(devices.paired).map((d) => str(d.deviceId)));
  const pairedNodes = new Set(list(nodes.paired).map((n) => str(n.nodeId)));
  const fromDevices = list(devices.pending).map((r): Req => ({
    id: str(r.requestId), kind: "device", name: str(r.displayName) || str(r.clientId) || "A device", plat: osOf(r.platform),
    access: accessOf(r.scopes), more: pairedDevices.has(str(r.deviceId)) || r.isRepair === true, ts: Number(r.ts) || 0,
    deviceId: str(r.deviceId), ip: str(r.remoteIp), version: "",
  }));
  const fromNodes = list(nodes.pending).map((r): Req => ({
    id: str(r.requestId), kind: "node", name: str(r.displayName) || "A computer", plat: osOf(r.platform),
    access: accessOf(r.commands), more: pairedNodes.has(str(r.nodeId)), ts: Number(r.ts) || 0,
    deviceId: str(r.nodeId), ip: str(r.remoteIp), version: str(r.uiVersion) || str(r.version),
  }));
  return [...fromDevices, ...fromNodes].filter((r) => r.id).sort((a, b) => b.ts - a.ts);
}

export function ComputerPage(props: SettingsPageProps) {
  const lv = lvOf(props.level);
  const agents = useLive<RecordValue>(props.engine, "agents.list", {}, ["agents"]);
  const nodes = useLive<RecordValue>(props.engine, "node.list", {}, PAIR_EVENTS);
  const { reload } = nodes;
  useEffect(() => { const again = () => void reload(); window.addEventListener("branch:computers-changed", again); return () => window.removeEventListener("branch:computers-changed", again); }, [reload]);
  return (
    <Page title={props.title} lede={LEDE}>
      <Waiting {...props} lv={lv} />
      <Computers {...props} lv={lv} nodes={nodes} agents={rec(agents.data)} />
      <WhichTrunk {...props} nodes={list(rec(nodes.data).nodes)} agents={list(rec(agents.data).agents)} defaultId={rec(agents.data).defaultId} />
      <ComputerMore {...props} />
    </Page>
  );
}

/** Waiting for your yes: Allow (on after 1.5 s, so a stray click can't allow) and Don't allow (asks first). */
function Waiting({ engine, lv }: SettingsPageProps & { lv: number }) {
  const devices = useLive<RecordValue>(engine, "device.pair.list", {}, PAIR_EVENTS);
  const nodes = useLive<RecordValue>(engine, "node.pair.list", {}, PAIR_EVENTS);
  const [all, setAll] = useState(false);
  const [refuse, setRefuse] = useState<Req | null>(null);
  const call = useCall();
  const reqs = requests(rec(devices.data), rec(nodes.data));
  const reload = () => { void devices.reload(); void nodes.reload(); };
  const decide = (r: Req, yes: boolean) => void call.run(async () => {
    await engine.request(`${r.kind}.pair.${yes ? "approve" : "reject"}`, { requestId: r.id });
    reload();
  }, () => yes ? (r.more ? `${r.name} may now ${r.access.map((a) => a.toLowerCase()).join(", ") || "do more"}.` : `${r.name} is connected. Pick which Trunks may use it.`) : `Turned down. ${r.name} has to ask again.`);
  const error = devices.error || nodes.error;
  if (!reqs.length && !error && !call.note) return null;
  const shown = all ? reqs : reqs.slice(0, 3);
  return (
    <Sec title="Waiting for your yes" hint="Only allow what you recognise. You can remove it later on this page." id="s2-waiting">
      {error ? <p className="hint s2-err" role="alert">{error}</p> : null}
      {shown.length ? <Plist>{shown.map((r) => <RequestRow key={`${r.kind}:${r.id}`} r={r} lv={lv} busy={call.busy} onAllow={() => decide(r, true)} onRefuse={() => setRefuse(r)} />)}</Plist> : null}
      {reqs.length > 3 && !all ? <Acts><Btn sm ghost onClick={() => setAll(true)}>{reqs.length - 3} more waiting</Btn></Acts> : null}
      <CallLine call={call} />
      {refuse ? (
        <Dialog title="Turn down this request?" onClose={() => setRefuse(null)} footer={<><Btn ghost onClick={() => setRefuse(null)}>Cancel</Btn><Btn className="bad" onClick={() => { decide(refuse, false); setRefuse(null); }}>Turn it down</Btn></>}>
          <p>{refuse.name} has to ask again before it can connect.</p>
        </Dialog>
      ) : null}
    </Sec>
  );
}

function RequestRow({ r, lv, busy, onAllow, onRefuse }: { r: Req; lv: number; busy: boolean; onAllow: () => void; onRefuse: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), ALLOW_DELAY_MS); return () => clearTimeout(t); }, []);
  const asked = when(r.ts);
  return (
    <div className="prow s2-req" data-row={r.name}>
      <Tile><Ico name={r.plat === "iOS" || r.plat === "Android" ? "phone" : r.plat === "macOS" ? "mac" : r.plat ? "monitor" : "globe"} s /></Tile>
      <span className="grow">
        <b>{r.name} {r.more ? "asks to do more" : "wants to connect"}</b>
        <small>
          {[r.plat, asked ? `asked ${asked}` : ""].filter(Boolean).join(" · ")}
          {r.access.length ? <> · {r.access.map((a, i) => <span key={a} className={RISKY.has(a) ? "s2-warn" : undefined}>{i ? ", " : ""}{a}</span>)}</> : null}
        </small>
        {r.more ? <small className="s2-note">Asks for more access than before</small> : null}
        {lv >= 2 ? <details className="s2-det"><summary>Details</summary><Kv rows={[["Device ID", r.deviceId], ["Address it came from", r.ip], ["App", r.version]]} /></details> : null}
      </span>
      <Btn sm ghost disabled={busy} onClick={onRefuse}>Don’t allow</Btn>
      <Btn sm pri disabled={busy || !ready} title={ready ? undefined : "Allow is ready in a moment"} onClick={onAllow}>Allow</Btn>
    </div>
  );
}

type Res = ReturnType<typeof useLive<RecordValue>>;
type Node = RecordValue;

/** Which Trunks are pinned to a computer (by node id or name). */
function usersOf(node: Node, agents: RecordValue, cfgAgents: RecordValue[]): string[] {
  const names = new Map(list(agents.agents).map((a) => [str(a.id), str(rec(a.identity).name) || str(a.name) || str(a.id)]));
  const id = str(node.nodeId); const name = str(node.displayName);
  return cfgAgents.filter((a) => { const pin = str(rec(rec(a.tools).exec).node); return pin && (pin === id || pin === name); }).map((a) => names.get(str(a.id)) ?? str(a.id));
}

function Computers({ engine, lv, nodes, agents }: SettingsPageProps & { lv: number; nodes: Res; agents: RecordValue }) {
  const status = useLive<RecordValue>(engine, "computer.status", {}, []);
  const config = useConfig(engine);
  // Each Trunk's own entry, keyed by id in agents.entries.
  const cfgAgents = Object.entries(rec(config.get("agents.entries"))).map(([id, entry]) => ({ ...rec(entry), id }));
  const [find, setFind] = useState({ q: "", sort: "Online first", show: "All" });
  const paired = list(rec(nodes.data).nodes).filter((n) => n.approvalState !== "pending-approval" && n.approvalState !== "unapproved");
  const all = lv >= 1 ? arrange(paired, find) : paired;
  const here = all.filter((n) => n.gatewayLocal === true);
  const other = all.filter((n) => n.gatewayLocal !== true);
  const card = (n: Node) => <ComputerCard key={str(n.nodeId)} engine={engine} node={n} lv={lv} users={usersOf(n, agents, cfgAgents)} onChanged={() => void nodes.reload()} />;
  const local = rec(status.data);
  // Screen control on this computer is enough to list it, even when computer.status
  // is missing — the chat already calls that machine "This computer".
  const screenOn = config.get("plugins.entries.cua-computer.enabled") === true;
  const usableHere = Boolean(status.data) || screenOn;
  const hereStatus: RecordValue = { ...local, available: local.available === true || screenOn };
  return (
    <Sec title="Computers they may use">
      {nodes.error ? <p className="hint s2-err" role="alert">{nodes.error}</p> : null}
      {lv >= 1 ? <FindRow find={find} onFind={setFind} onRefresh={() => { void nodes.reload(); void status.reload(); }} /> : null}
      {lv >= 1 && paired.length && !all.length ? <Hint>No computer matches.</Hint> : null}
      {here.length || (usableHere && !find.q) ? <div className="s2-grp">On this computer</div> : null}
      <div className="s2-comps">
        {here.map(card)}
        {usableHere && !here.length && !find.q ? <ThisComputer status={hereStatus} /> : null}
      </div>
      {other.length ? <><div className="s2-grp">Your other computers</div><div className="s2-comps">{other.map(card)}</div></> : null}
      {nodes.data && !all.length && !usableHere && !config.loading ? <Hint>No computers are paired yet.</Hint> : null}
      <InTheCloud engine={engine} />
      <DesktopCtl title="Keep this computer awake" sub="Keeps this computer awake while Trunks use it." help="Stays awake between tasks while Trunks may use it. Locking and signing out still work; Branch never unlocks it. Off until you choose: it stops this computer sleeping on its power plan." name="keepAwake" />
      <Acts><Btn pri onClick={() => window.dispatchEvent(new CustomEvent("branch:add-computer"))}><Icon name="plus" small />Add a computer</Btn></Acts>
    </Sec>
  );
}

/** In the cloud: KeepOak's own card (greyed until keepoak.com has a sign-in) and a cloud computer from a profile the
 *  engine has (environments.list, environments.create). */
function InTheCloud({ engine }: Pick<SettingsPageProps, "engine">) {
  const envs = useLive<RecordValue>(engine, "environments.list", {}, ["node", "environments"]);
  const [open, setOpen] = useState(false);
  const profiles = list(rec(envs.data).profiles);
  return (
    <>
      <div className="s2-grp">In the cloud</div>
      <div className="s2-comps">
        <div className="s2-comp s2cm-offc" data-row="KeepOak computer">
          <Tile><Ico name="cloud" s /></Tile>
          <span className="grow">
            <b>KeepOak computer</b>
            <small>Cloud · KeepOak</small>
            <span className="s2-reach">A cloud computer whose machines run on your keepoak.com plan.</span>
          </span>
          <Btn sm disabled title={KEEPOAK_OFF}>Connect keepoak.com</Btn>
        </div>
      </div>
      <div className="s2cm-offer" role="note">
        <Tile><Ico name="cloud" s /></Tile>
        <span className="grow"><b>A cloud computer</b><small>A fresh machine for each conversation on your own cloud account or KeepOak, thrown away when its work stops. Off until you choose: the provider bills while machines run.</small></span>
        <Btn sm disabled={!profiles.length} title={profiles.length ? undefined : NO_PROFILE} onClick={() => setOpen(true)}>Set one up</Btn>
        {open ? <NewCloud engine={engine} profiles={profiles} onClose={(made) => { setOpen(false); if (made) void envs.reload(); }} /> : null}
      </div>
    </>
  );
}
const KEEPOAK_OFF = "keepoak.com has no sign-in Branch can use yet.";
const NO_PROFILE = "Needs a cloud computer provider set up in this engine.";

type Find = { q: string; sort: string; show: string };
/** Advanced: find, sort and filter the computers. */
function arrange(nodes: Node[], f: Find): Node[] {
  const q = f.q.trim().toLowerCase();
  const on = (n: Node) => (n.connected === true ? 1 : 0);
  const name = (n: Node) => str(n.displayName) || str(n.nodeId);
  return nodes
    .filter((n) => !q || name(n).toLowerCase().includes(q))
    .filter((n) => f.show === "All" || (f.show === "Online") === (n.connected === true))
    .sort((a, b) => f.sort === "A to Z" ? name(a).localeCompare(name(b)) : f.sort === "Online first" ? on(b) - on(a) : on(a) - on(b));
}
function FindRow({ find, onFind, onRefresh }: { find: Find; onFind: (f: Find) => void; onRefresh: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const items: MenuItem[] = [
    { kind: "head", label: "Sort by" },
    ...["Online first", "Offline first", "A to Z"].map((v): MenuItem => ({ label: `${find.sort === v ? "✓ " : ""}${v}`, run: () => onFind({ ...find, sort: v }) })),
    { kind: "sep" }, { kind: "head", label: "Show" },
    ...["All", "Online", "Offline"].map((v): MenuItem => ({ label: `${find.show === v ? "✓ " : ""}${v}`, run: () => onFind({ ...find, show: v }) })),
  ];
  return (
    <div className="s2-find">
      <input className="inp" type="search" placeholder="Find a computer…" aria-label="Find a computer" value={find.q} onChange={(e) => onFind({ ...find, q: e.target.value })} />
      <Btn sm ghost aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}><Icon name="sliders" small />{find.sort} · {find.show}</Btn>
      <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={onRefresh}><Ico name="retry" s /></button>
      {menu ? <Menu at={menu} items={items} label="Sort and show" onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** The Gateway's own computer when no node host runs on it: what computer.status reports. */
function ThisComputer({ status }: { status: RecordValue }) {
  const use = rec(status.computerUse);
  const ok = status.available === true;
  return (
    <div className="s2-comp" data-row="This computer">
      <Tile><Ico name="monitor" s /></Tile>
      <span className="grow">
        <b>This computer</b>
        <small>{str(rec(use.provider).label) || "The computer Branch runs on"}</small>
        <span className="s2-reach">{ok ? "Your screen, mouse and apps. It asks before an app it hasn’t used, and you can take over any time." : str(status.error) || shownWhy("Computer control isn’t set up in this engine.")}</span>
      </span>
      <Pill tone={ok ? "ok" : "idle"}>{ok ? "Ready" : "Not set up"}</Pill>
    </div>
  );
}

function ComputerCard({ engine, node, lv, users, onChanged }: Pick<SettingsPageProps, "engine"> & { node: Node; lv: number; users: string[]; onChanged: () => void }) {
  const [dlg, setDlg] = useState<"" | "details" | "rename" | "remove">("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const name = str(node.displayName) || str(node.nodeId);
  const slots = rec(node.workerSlots);
  const total = Number(slots.total) || 0;
  const busy = total ? total - (Number(slots.available) || 0) : 0;
  const issues = list(node.issues);
  const items: MenuItem[] = [
    { label: "Rename…", run: () => setDlg("rename") },
    { kind: "sep" },
    { label: "Remove…", danger: true, run: () => setDlg("remove") },
    ...(lv >= 2 ? [{ label: "Copy its ID", run: () => void navigator.clipboard.writeText(str(node.nodeId)).then(undefined, () => setDlg("details")) }] : []),
  ];
  return (
    <div className="s2-comp s2-click" role="button" tabIndex={0} aria-label={`${name}: details`} data-row={name}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) setDlg("details"); }}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); setDlg("details"); } }}>
      <Tile><Ico name={/mac|darwin/i.test(str(node.platform)) ? "mac" : "monitor"} s /></Tile>
      <span className="grow">
        <b>{name}</b>
        <small>{[osOf(node.platform), node.connected === true ? "online" : node.lastSeenAtMs ? `last seen ${when(node.lastSeenAtMs)}` : "offline"].filter(Boolean).join(" · ")}</small>
        {issues.map((i, k) => <span key={k} className="s2-cwarn">{str(i.message) || str(i.code)}</span>)}
        {users.length ? <span className="s2-users">Used by {users.join(", ")}</span> : null}
        {node.connected === true ? <span className="s2-watch"><Btn sm ghost onClick={() => watch(node.gatewayLocal === true ? "gateway" : `node:${str(node.nodeId)}`)}>Watch its screen</Btn></span> : null}
        {total ? <span className="s2-busy"><span className="s2-meter" aria-hidden="true"><u style={{ width: `${Math.round((busy / total) * 100)}%` }} /></span>{busy} of {total} busy</span> : null}
        {lv >= 1 ? <Load node={node} /> : null}
      </span>
      <Pill tone={node.connected === true ? "ok" : "idle"}>{node.connected === true ? "Ready" : "Offline"}</Pill>
      <button ref={more} type="button" className="icon-btn" aria-label={`More for ${name}`} aria-haspopup="menu" onClick={() => { const r = more.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 200, y: r.bottom + 4 } : null); }}><Icon name="more" small /></button>
      {menu ? <Menu at={menu} items={items} label={`More for ${name}`} onClose={() => setMenu(null)} /> : null}
      {dlg === "details" ? <DetailsDialog node={node} lv={lv} users={users} onClose={() => setDlg("")} /> : null}
      {dlg === "rename" ? <RenameDialog engine={engine} node={node} onClose={(changed) => { setDlg(""); if (changed) onChanged(); }} /> : null}
      {dlg === "remove" ? <RemoveDialog engine={engine} node={node} onClose={(changed) => { setDlg(""); if (changed) onChanged(); }} /> : null}
    </div>
  );
}

function Load({ node }: { node: Node }) {
  const s = rec(node.hostStats);
  if (!s.cpuCount) return null;
  const load = Array.isArray(s.loadAverage) ? Number(s.loadAverage[0]).toFixed(1) : "";
  const total = Number(s.memoryTotalBytes) || 0;
  const used = total - (Number(s.memoryFreeBytes) || 0);
  return (
    <span className="s2-busy">
      {load ? <span title={`Load average (1 min) on ${str(s.cpuCount)} cores`}>load {load}</span> : null}
      {total ? <span>{load ? " · " : ""}{bytes(used)}/{bytes(total)} memory</span> : null}
      {s.diskAvailableBytes !== undefined ? <span> · {bytes(s.diskAvailableBytes)} free</span> : null}
    </span>
  );
}

function DetailsDialog({ node, lv, users, onClose }: { node: Node; lv: number; users: string[]; onClose: () => void }) {
  const name = str(node.displayName) || str(node.nodeId);
  const caps = (Array.isArray(node.caps) ? node.caps : []).map(String);
  const s = rec(node.hostStats);
  return (
    <Dialog title={name} wide onClose={onClose}>
      <p>{node.connected === true ? "Connected" : `Offline${node.lastSeenAtMs ? ` · last reported ${when(node.lastSeenAtMs)}` : ""}`}</p>
      <Kv rows={[["Kind", node.gatewayLocal === true ? "The computer Branch runs on" : "Another computer"], ["System", [osOf(node.platform), str(node.modelIdentifier)].filter(Boolean).join(" · ")], ["Version", str(node.version)], ...(lv >= 2 ? [["ID", <code key="id">{str(node.nodeId)}</code>] as [string, ReactNode]] : [])]} />
      {lv >= 1 ? (
        <>
          <h3 className="s2-h3">What it can do</h3>
          {caps.length ? <div className="s2-chips">{caps.map((c) => <span key={c} className="chip6">{c}</span>)}</div> : <p className="hint">It hasn’t said what it can do.</p>}
          <h3 className="s2-h3">Reported statistics</h3>
          {s.cpuCount ? <Kv rows={[["Processor", `${str(s.cpuCount)} cores${Array.isArray(s.loadAverage) ? ` · load ${Number(s.loadAverage[0]).toFixed(2)}` : ""}`], ["Memory used", s.memoryTotalBytes ? `${bytes(Number(s.memoryTotalBytes) - Number(s.memoryFreeBytes))} of ${bytes(s.memoryTotalBytes)}` : ""], ["Disk free", s.diskTotalBytes ? `${bytes(s.diskAvailableBytes)} of ${bytes(s.diskTotalBytes)}` : ""], ["Sampled", when(s.updatedAtMs)]]} /> : <p className="hint">This computer hasn’t reported its statistics.</p>}
        </>
      ) : null}
      <h3 className="s2-h3">Trunks that use it</h3>
      {users.length ? <p>{users.join(", ")}</p> : <p className="hint">No Trunk is pinned to it; any Trunk may use it when a task needs it.</p>}
      {lv >= 2 ? <Acts><CopyBtn text={str(node.nodeId)} label="Copy its ID" /></Acts> : null}
    </Dialog>
  );
}

function RenameDialog({ engine, node, onClose }: Pick<SettingsPageProps, "engine"> & { node: Node; onClose: (changed: boolean) => void }) {
  const [name, setName] = useState(str(node.displayName));
  const call = useCall();
  const save = () => void call.run(async () => { await engine.request("node.rename", { nodeId: str(node.nodeId), displayName: name.trim() }); onClose(true); });
  return (
    <Dialog title={`Rename ${str(node.displayName) || str(node.nodeId)}`} onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn pri disabled={!name.trim() || call.busy} onClick={save}>Rename</Btn></>}>
      <label className="s2-field"><span>Name</span><input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }} /></label>
      <p className="hint">Shown instead of its computer name in Branch.</p>
      <CallLine call={call} />
    </Dialog>
  );
}

function RemoveDialog({ engine, node, onClose }: Pick<SettingsPageProps, "engine"> & { node: Node; onClose: (changed: boolean) => void }) {
  const call = useCall();
  const name = str(node.displayName) || str(node.nodeId);
  const go = () => void call.run(async () => { await engine.request("node.pair.remove", { nodeId: str(node.nodeId) }); onClose(true); });
  return (
    <Dialog title={`Remove ${name}?`} onClose={() => onClose(false)} footer={<><Btn ghost onClick={() => onClose(false)}>Cancel</Btn><Btn className="bad" disabled={call.busy} onClick={go}>Remove</Btn></>}>
      <p>It must pair again before Trunks can use it.</p>
      <CallLine call={call} />
    </Dialog>
  );
}

/** Which Trunk uses which: a Trunk pinned to a computer runs its commands there (agents.entries.<id>.tools.exec.node). */
function WhichTrunk({ engine, nodes, agents, defaultId }: SettingsPageProps & { nodes: Node[]; agents: RecordValue[]; defaultId: unknown }) {
  const config = useConfig(engine);
  const entries = rec(config.get("agents.entries"));
  const usable = nodes.filter((n) => n.approvalState !== "pending-approval" && n.approvalState !== "unapproved");
  if (!agents.length) return null;
  const main = str(defaultId);
  const ordered = [...agents.filter((a) => str(a.id) !== main), ...agents.filter((a) => str(a.id) === main)];
  // One Trunk's own entry only (a hot-applied, single-Trunk change; null puts the default back).
  const pin = (agentId: string, nodeId: string | null) => void config.set(`agents.entries.${agentId}.tools.exec.node`, nodeId);
  return (
    <Sec title="Which Trunk uses which" hint="A Trunk can use several computers side by side.">
      <Plist>
        {ordered.map((a) => {
          const id = str(a.id); const name = str(rec(a.identity).name) || str(a.name) || id;
          const entry = id in entries ? rec(entries[id]) : undefined;
          const pinned = str(rec(rec(entry?.tools).exec).node);
          return (
            <div key={id} className="prow s2-percomp" data-row={name}>
              <Face size={32} label={name} />
              <span className="grow">
                <b>{name}</b>
                <span className="s2-chips" role="group" aria-label={`Computers ${name} uses`}>
                  {usable.map((n) => {
                    const nid = str(n.nodeId); const on = pinned === nid || pinned === str(n.displayName);
                    return <button key={nid} type="button" className="chip6" aria-pressed={on} disabled={!entry || config.loading} title={entry ? undefined : "This Trunk follows the default settings; give it its own settings first."} onClick={() => pin(id, on ? null : nid)}>{str(n.displayName) || nid}</button>;
                  })}
                </span>
              </span>
            </div>
          );
        })}
      </Plist>
    </Sec>
  );
}
