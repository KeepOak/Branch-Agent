// Settings › Gateway (DESIGN-SPEC §4.7.15): the gateway's state (health, system.info, presence), its reach and
// sign-in (config gateway.bind / port / auth / tailscale / controlUi), restarting it (gateway.restart.request),
// a live ping measured by this page, exposure, limits and another computer (gateway.remote.*).
// Run mode, the tray and quitting belong to the Branch app.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Field, Hint, Num, Page, Pick, Sec, Seg, Status, Switch, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { CallLine, CodeRow, Kv, bytes, lvOf, rec, span, str, useCall, useLive, when, type RecordValue } from "./common";
import { Icon } from "../../../shell/icons";
import { useDesktopControls } from "../../../connect/desktop-controls";
import { formatMoney } from "../../../format/money";
import "./gateway.css";

const LEDE = "A small helper that keeps Branch running in the background, starts it again if it stops, and carries interrupted work on.";
const APP = "Set by the Branch app on this computer.";
const CONN = "This window’s connection is set by the Branch app; another computer is picked with the switcher at the top of the list.";
const BIND = [{ id: "loopback", label: "This computer" }, { id: "lan", label: "My network" }, { id: "tailnet", label: "Tailscale" }, { id: "custom", label: "One address" }, { id: "auto", label: "Automatic" }];
const BIND_LINE: Record<string, string> = { loopback: "Only this computer.", lan: "Any device on your network.", tailnet: "Your Tailscale devices, and this computer.", custom: "One address you choose, and this computer.", auto: "This computer if it can, otherwise every network." };
const AUTH = [{ id: "token", label: "Session key" }, { id: "password", label: "Password" }, { id: "trusted-proxy", label: "Trusted proxy" }, { id: "none", label: "None" }];
const COLORS = ["teal", "amber", "purple", "coral", "pink", "blue", "green", "red", "grey"];
const DEFAULT_PORT = 18789;

export const ROWS: RowEntry[] = [
  ["Gateway", "Keep Branch running", 0], ["Keep working when the window closes", "Keep Branch running", 0], ["Carry on interrupted work by itself", "Keep Branch running", 0], ["Show the gateway in the tray", "Keep Branch running", 0],
  ["Ask before quitting while work runs", "Keep Branch running", 0], ["A terminal where the Gateway runs", "What it has been doing", 1],
  ["Who can reach the Gateway", "Reach", 1], ["Port", "Reach", 2], ["Sign-in", "Reach", 2], ["Through Cloudflare", "Reach", 1], ["Tailscale", "Reach", 1],
  ["Tailscale access", "Reach", 1], ["Serve Branch’s page to browsers", "Reach", 2], ["Label this computer", "How it’s reached", 1], ["Branch in your browser", "How it’s reached", 1],
  ["Web address path", "How it’s reached", 2], ["Gateway address", "Connection", 2], ["Session key or password", "Connection", 2],
  ["How to reach it", "Another computer", 1], ["Check the SSH host key", "Another computer", 2], ["Sign in through a proxy", "Another computer", 2],
  ["Pause a chat app from the chat", "Chat apps, more", 1], ["Canary, journal and rollback", "Never break", 1], ["Apply settings changes", "Technical", 2], ["Only join a running Gateway", "Technical", 2],
  ["Infrastructure settings", "Technical", 2], ["Accept files and pictures", "Exposure", 2], ["HSTS header", "Exposure", 2], ["HTTPS for the Gateway", "Exposure", 2], ["Allowed browser addresses", "Exposure", 2],
  ["Trust the Host header for origins", "Exposure", 2], ["Wrong sign-ins allowed", "Limits", 2], ["Then lock that address for", "Limits", 2], ["Never lock out this computer", "Limits", 2],
  ["Reach previews from other devices", "App previews", 2], ["Send a message", "From scripts", 2], ["Connect a chat app", "From scripts", 2],
].map(([title, sec, lv]) => ({ page: "gateway", title: String(title), sec: String(sec), group: ({ Reach: "Connection", "How it’s reached": "Connection", Exposure: "Connection", Limits: "Connection", Technical: "Connection", "From scripts": "Connection", "Never break": "If it stops", "Chat apps, more": "Chat apps" } as Record<string, string>)[String(sec)] ?? String(sec), lv: lv as 0 | 1 | 2 }));

type Config = ReturnType<typeof useConfig>;
type Ctx = SettingsPageProps & { config: Config; health: RecordValue; sys: RecordValue; healthError?: string; lv: number };

export function GatewayPage(props: SettingsPageProps) {
  const config = useConfig(props.engine);
  const health = useLive<RecordValue>(props.engine, "health", { probe: false }, ["health"]);
  const sys = useLive<RecordValue>(props.engine, "system.info", {}, []);
  const ctx: Ctx = { ...props, config, health: rec(health.data), sys: rec(sys.data), healthError: health.error, lv: lvOf(props.level) };
  return (
    <Page title={props.title} lede={LEDE}>
      <GatewayStatus {...ctx} />
      <KeepRunning />
      {ctx.lv >= 1 ? <Reach {...ctx} /> : null}
      {ctx.lv >= 1 ? <Reached {...ctx} /> : null}
      <Doing {...ctx} />
      {ctx.lv >= 2 ? <Connection {...ctx} /> : null}
      {ctx.lv >= 2 ? <Technical {...ctx} /> : null}
      {ctx.lv >= 2 ? <Exposure {...ctx} /> : null}
      {ctx.lv >= 2 ? <Limits {...ctx} /> : null}
      {ctx.lv >= 2 ? <Previews /> : null}
      {ctx.lv >= 1 ? <Another {...ctx} /> : null}
      {ctx.lv >= 1 ? <ChatApps lv={ctx.lv} /> : null}
    </Page>
  );
}

function channelNames(health: RecordValue): string[] {
  const labels = rec(health.channelLabels);
  return Object.entries(rec(health.channels)).filter(([, v]) => {
    const channel = rec(v);
    return channel.connected === true || (channel.connected !== false && channel.running === true);
  }).map(([id]) => str(labels[id]) || id);
}

/** "just now", "4 min ago", "2 h ago", or the day and time. */
function ago(ms: unknown, now = Date.now()): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return min < 24 * 60 ? `${Math.floor(min / 60)} h ago` : when(ms);
}

function GatewayStatus({ health, sys, healthError }: Ctx) {
  if (healthError) return <Status tone="bad" title="The gateway isn’t answering">{healthError} Branch keeps trying; Restart the engine below if it stays this way.</Status>;
  if (health.ok === false) return <Status tone="bad" title="The gateway needs attention">The gateway answered, but its health check failed. Restart the engine below if it stays this way.</Status>;
  if (health.ok !== true) return <Status tone="idle" title="Gateway health not reported">Waiting for a health result from the gateway.</Status>;
  const up = span(sys.uptimeMs);
  const chats = channelNames(health);
  return (
    <Status title="The gateway is on">
      {`On.${up ? ` Up ${up}.` : ""}${chats.length ? ` ${chats.join(", ")} keep${chats.length === 1 ? "s" : ""} working when the window is closed.` : ""}`}
    </Status>
  );
}

function KeepRunning() {
  const desk = useDesktopControls();
  return (
    <Sec title="Keep Branch running">
      <Ctl title="Gateway" sub="Recommended: On." help="Recommended: On. Telegram, your phone and automations keep working when the window is closed." off={APP}>
        <Seg label="Gateway" value="on" onChange={() => undefined} options={[{ id: "off", label: "Off" }, { id: "when-needed", label: "When needed" }, { id: "on", label: "On" }]} />
      </Ctl>
      <Ctl title="Keep working when the window closes" sub="Trunks finish what they started." off={desk.off}>
        <Switch checked={desk.state?.keepWorking ?? false} disabled={desk.busy !== null} label="Keep working when the window closes" onChange={(on) => void desk.set("keepWorking", on)} />
      </Ctl>
      <Ctl title="Carry on interrupted work by itself" sub="After a restart, safe steps carry on." help="After a restart, safe steps carry on. Anything that sends or changes something asks you first." off="The engine carries safe steps on by itself; there is no switch for it."><Switch label="Carry on interrupted work by itself" checked onChange={() => undefined} /></Ctl>
      <Ctl title="Show the gateway in the tray" sub="A small Branch icon by the clock with Restart and Quit." off={APP}><Switch label="Show the gateway in the tray" checked onChange={() => undefined} /></Ctl>
      <Ctl title="Ask before quitting while work runs" sub="Quit asks first while a Trunk is working." help="Quit asks first while a Trunk is working. Off until you choose: Branch quits at once." off={APP}><Switch label="Ask before quitting while work runs" checked={false} onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

function Reach({ config, lv }: Ctx) {
  const bind = str(config.get("gateway.bind")) || "loopback";
  const port = config.get("gateway.port");
  const auth = str(config.get("gateway.auth.mode")) || "token";
  const ts = str(config.get("gateway.tailscale.mode")) || "off";
  return (
    <Sec title="Reach" group="Connection">
      <Ctl title="Who can reach the Gateway" sub={BIND_LINE[bind]}>
        <Seg label="Who can reach the Gateway" value={bind} disabled={config.loading} onChange={(v) => void config.set("gateway.bind", v)} options={BIND} />
      </Ctl>
      {bind === "custom" ? <Ctl title="The address"><Field label="The address" value={str(config.get("gateway.customBindHost"))} placeholder="192.168.1.20" onCommit={(v) => void config.set("gateway.customBindHost", v || null)} /></Ctl> : null}
      {lv >= 2 ? (
        <>
          <Ctl title="Port" sub="One port for the window, phones and chat apps.">
            <Num label="Port" value={typeof port === "number" ? port : undefined} placeholder={String(DEFAULT_PORT)} min={1} max={65535} onCommit={(v) => void config.set("gateway.port", v)} />
          </Ctl>
          <Ctl title="Sign-in" sub="How people and apps prove who they are." help="How people and apps prove who they are. Changing it restarts the Gateway.">
            <Pick label="Sign-in" value={auth} disabled={config.loading} onChange={(v) => void config.set("gateway.auth.mode", v)} options={AUTH} />
          </Ctl>
        </>
      ) : null}
      <Ctl title="Through Cloudflare" sub="A public https address with Cloudflare sign-in in front." help="A public https address with Cloudflare sign-in in front. The Gateway stays on this computer and no port opens. Off until you choose: it puts Branch on a public address behind Cloudflare sign-in." off="Needs a Cloudflare tunnel set up outside Branch."><Btn sm>Set up</Btn></Ctl>
      <Ctl title="Tailscale" sub="Reach Branch from your other devices over Tailscale." help="Reach Branch from your other devices over Tailscale. Off until you choose: it opens Branch to other devices." off="Branch can’t read Tailscale’s state from this engine." />
      <Ctl title="Tailscale access" sub="Branch doesn’t set Tailscale up.">
        <Seg label="Tailscale access" value={ts} disabled={config.loading} onChange={(v) => void config.set("gateway.tailscale.mode", v)} options={[{ id: "off", label: "Off" }, { id: "serve", label: "My tailnet" }, { id: "funnel", label: "Public" }]} />
      </Ctl>
      {lv >= 2 ? (
        <Ctl title="Serve Branch’s page to browsers" sub="The page at Branch’s address. Off keeps chat apps and devices working.">
          <Switch label="Serve Branch’s page to browsers" checked={config.get("gateway.controlUi.enabled") !== false} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.enabled", on)} />
        </Ctl>
      ) : null}
    </Sec>
  );
}

function localAddress(config: Config, sys: RecordValue): string {
  const port = Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT;
  const base = str(config.get("gateway.controlUi.basePath")).replace(/^\/?/, "/").replace(/\/$/, "");
  return `http://127.0.0.1:${port}${base}/`;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "3 apps connected · Chat apps: 2 of 3 working · Spent today: $0.42", from presence.query, health and usage.cost. */
function ReachedStatus({ engine, health, openSettings, title }: Ctx & { title: string }) {
  const presence = useLive<RecordValue>(engine, "presence.query", {}, ["presence"]);
  const today = ymd(new Date());
  const cost = useLive<RecordValue>(engine, "usage.cost", { startDate: today, endDate: today, agentScope: "all", mode: "specific", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }, []);
  const devices = Number(rec(presence.data).totalDevices) || list(rec(presence.data).devices).length;
  const chats = Object.keys(rec(health.channels)).length;
  const spent = rec(rec(cost.data).totals).totalCost;
  const parts = [presence.data ? `${devices} ${devices === 1 ? "app" : "apps"} connected` : "Connected apps not reported", chats ? `Chat apps: ${channelNames(health).length} of ${chats} working` : ""].filter(Boolean);
  return (
    <Status title={title}>
      {parts.join(" · ")}
      {typeof spent === "number" ? <>{" · "}<button type="button" className="link-k" disabled={!openSettings} onClick={() => openSettings?.("usage")}>{`Spent today: ${formatMoney(spent)}`}</button></> : null}
    </Status>
  );
}

function Reached(ctx: Ctx) {
  const { config, sys, lv } = ctx;
  const env = rec(config.get("gateway.controlUi.environment"));
  const label = str(env.label);
  const color = str(env.color) || "teal";
  const page = config.get("gateway.controlUi.enabled") !== false;
  const bind = BIND.find((b) => b.id === (str(config.get("gateway.bind")) || "loopback"))?.label ?? "This computer";
  const open = () => window.open(localAddress(config, sys), "_blank", "noopener");
  return (
    <Sec title="How it’s reached" group="Connection" showHeading={false}>
      <ReachedStatus {...ctx} title={`${bind} · ${label || str(sys.machineName) || "This computer"}`} />
      <Acts>
        <Btn sm disabled={!page} title={page ? undefined : "Turn on Branch in your browser first."} onClick={open}>Open in a browser</Btn>
        <Btn sm disabled title="Opens a terminal on your computer, from the Branch app.">Open a terminal here</Btn>
      </Acts>
      <Ctl title="Label this computer" sub="Shows which computer a window talks to." help="Off until you set a label: shows which computer a window talks to when you use more than one. 1 to 24 characters."
        after={<span className="gw-swatches" role="radiogroup" aria-label="Label colour">{COLORS.map((c) => <button key={c} type="button" role="radio" className={`gw-sw-${c}`} aria-label={c} aria-checked={Boolean(label) && c === color} disabled={!label} title={label ? c : "Set a label first."} onClick={() => void config.set("gateway.controlUi.environment", { label, color: c })} />)}</span>}>
        <Field label="Label this computer" value={label} placeholder="For example Staging" onCommit={(v) => void config.set("gateway.controlUi.environment", v.trim() ? { label: v.trim().slice(0, 24), color } : null)} />
      </Ctl>
      <Ctl title="Branch in your browser" sub="The Gateway also serves this window to a local browser." help="The gateway also shows this window to a browser on this computer, at the local address. Links Branch hands out open that page there. It works while the gateway runs."
        after={<div className="gw-x"><Acts><Btn sm disabled={!page} onClick={open}>Open in browser</Btn></Acts></div>}>
        <Switch label="Branch in your browser" checked={page} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.enabled", on)} />
      </Ctl>
      {lv >= 2 ? (
        <Ctl title="Web address path" sub="Empty means the root of the local address." help="Empty means the root of the local address. Changing it restarts the gateway.">
          <Field label="Web address path" value={str(config.get("gateway.controlUi.basePath"))} placeholder="/branch" onCommit={(v) => void config.set("gateway.controlUi.basePath", v.trim() || null)} />
        </Ctl>
      ) : null}
    </Sec>
  );
}

function Doing({ engine, health, sys, lv }: Ctx) {
  const restart = useCall();
  const started = typeof sys.uptimeMs === "number" ? Date.now() - Number(sys.uptimeMs) : undefined;
  const go = () => void restart.run(() => engine.request<RecordValue>("gateway.restart.request", { reason: "settings" }), (r) => (rec(r).status === "deferred" ? "Restarting once the running work finishes." : "Restarting. The window reconnects by itself."));
  return (
    <Sec title="What it has been doing">
      <ol className="gw-tl">
        {started ? <li className="ok"><Icon name="check" small /><span>Started<small>{when(started)}</small></span></li> : null}
        {health.ts ? <li className={health.ok === true ? "ok" : undefined}><Icon name={health.ok === true ? "check" : "clock"} small /><span>Health check<small>{`${health.ok === false ? "Failed" : health.ok === true ? "Passed" : "Result not reported"}${typeof health.durationMs === "number" ? ` in ${health.durationMs} ms` : ""} ${ago(health.ts)}`}</small></span></li> : null}
      </ol>
      <Acts><Btn onClick={go} disabled={restart.busy}><Icon name="retry" small />Restart the engine</Btn></Acts>
      <CallLine call={restart} />
      {lv >= 1 ? <Ctl title="A terminal where the Gateway runs" sub="Opens a terminal here in WSL or remotely over SSH." help="Opens a terminal on the Gateway’s computer: in WSL here, or over SSH on another computer." off="Open it from a conversation’s side panel (Terminal)."><Btn sm disabled>Open terminal</Btn></Ctl> : null}
    </Sec>
  );
}

/** Connection (Technical): a ping this page measures every 5 s while it is open, and the gateway's own load, asked as often. */
function usePing(engine: SettingsPageProps["engine"]) {
  const [pings, setPings] = useState<number[]>([]);
  const [missed, setMissed] = useState(0);
  const [sys, setSys] = useState<RecordValue | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    let live = true;
    const ping = async () => {
      if (busy.current) return;
      busy.current = true;
      const t = performance.now();
      try { await engine.request("health", { probe: false }); if (live) setPings((p) => [...p.slice(-99), performance.now() - t]); }
      catch { if (live) setMissed((n) => n + 1); }
      finally { busy.current = false; }
      engine.request<RecordValue>("system.info", {}).then((r) => { if (live) setSys(rec(r)); }, () => undefined);
    };
    void ping();
    const id = setInterval(() => void ping(), 5000);
    return () => { live = false; clearInterval(id); };
  }, [engine]);
  return { pings, missed, sys };
}
function pct(sorted: number[], p: number): string { return sorted.length ? `${Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])} ms` : ""; }

function Connection({ engine, config, sys: first }: Ctx) {
  const { pings, missed, sys: polled } = usePing(engine);
  const sys = polled ?? first;
  const sorted = [...pings].sort((a, b) => a - b);
  const mem = rec(sys.processMemory);
  const loop = rec(sys.eventLoop);
  const address = engine.gatewayUrl?.replace(/[?#].*$/, "") || `ws://127.0.0.1:${Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT}`;
  return (
    <Sec title="Connection" showHeading={false}>
      <Kv rows={[["Connected to", address.replace(/^wss?:\/\//, "").replace(/\/$/, "")], ["Sign-in", AUTH.find((a) => a.id === (str(config.get("gateway.auth.mode")) || "token"))?.label.toLowerCase() ?? ""]]} />
      <Ctl title="Gateway address" sub="Use wss:// for another computer or a secure remote address." help="Use wss:// behind HTTPS or Tailscale, and for any computer that isn’t this one." off={CONN}>
        <input className="inp" aria-label="Gateway address" value={address} readOnly spellCheck={false} />
      </Ctl>
      <Ctl title="Session key or password" sub="The session key is kept for this window." help="The session key is kept for this window. Passwords are never stored. A phone setup code works here too." off={CONN}>
        <input className="inp" type="password" aria-label="Session key or password" autoComplete="off" readOnly />
        <button type="button" className="ib" aria-label="Show the key" disabled><Icon name="eye" small /></button>
      </Ctl>
      <Acts><Btn sm disabled title={CONN}>Reconnect</Btn></Acts>
      <h3 className="s2-h3">Gateway ping</h3>
      <Kv rows={[["Latest", pings.length ? `${Math.round(pings[pings.length - 1])} ms` : ""], ["Average", pings.length ? `${Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)} ms` : ""], ["p50", pct(sorted, 50)], ["p95", pct(sorted, 95)], ["p99", pct(sorted, 99)]]} />
      <Hint>{`Pings kept: ${pings.length}/100${missed ? ` · ${missed} missed` : ""} · every 5 s while this page is open`}</Hint>
      <h3 className="s2-h3">Gateway activity</h3>
      <Hint>The Gateway’s own processor, memory and event-loop delay · every 5 s while this page is open</Hint>
      <Kv rows={[["Processor", typeof loop.cpuCoreRatio === "number" ? `${Math.round(Number(loop.cpuCoreRatio) * 100)}%` : ""], ["Memory", bytes(mem.rssBytes)], ["Event-loop delay", typeof loop.delayP99Ms === "number" ? `${Math.round(Number(loop.delayP99Ms))} ms` : ""], ["This computer", sys.uptimeMs ? `up ${span(sys.uptimeMs)}` : ""], ["Cores", sys.cpuCount ? `${str(sys.cpuCount)} cores${Array.isArray(sys.loadAverage) ? ` · load ${sys.loadAverage.map((n) => Number(n).toFixed(2)).join(" ")}` : ""}` : ""], ["Disk", sys.diskTotalBytes ? `${bytes(sys.diskAvailableBytes)} free of ${bytes(sys.diskTotalBytes)}` : ""], ["Node", sys.nodeVersion ? `${str(sys.nodeVersion)} · process ${str(sys.pid)}` : ""]]} />
    </Sec>
  );
}

function Technical({ config, sys, openSettings }: Ctx) {
  const reload = str(config.get("gateway.reload.mode")) || "hybrid";
  return (
    <Sec title="Technical" group="Connection" showHeading={false}>
      <Ctl title="Apply settings changes" sub="Applies safe changes live; restarts when needed." help="Live applies safe changes at once and restarts the Gateway when one needs it.">
        <Seg label="Apply settings changes" value={reload} disabled={config.loading} onChange={(v) => void config.set("gateway.reload.mode", v)} options={[{ id: "hybrid", label: "Live" }, { id: "off", label: "Only on restart" }]} />
      </Ctl>
      <Kv rows={[["mode", str(config.get("gateway.mode")) || "local"], ["Address", `${str(config.get("gateway.bind")) || "loopback"} : ${Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT}`], ["Sign-in", AUTH.find((a) => a.id === (str(config.get("gateway.auth.mode")) || "token"))?.label ?? ""], ["Process", str(sys.pid)]]} />
      <Ctl title="Only join a running Gateway" sub="For people who run the Gateway themselves." help="For people who run the Gateway themselves. Off until you choose: nothing keeps Branch running when the window closes." off={APP}><Switch label="Only join a running Gateway" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Infrastructure settings" sub="Settings for the Gateway, browser and connected computers." help="Every setting for the Gateway, the browser, computers that join, finding computers nearby and the agent protocol.">
        <Btn sm disabled={!openSettings} onClick={() => openSettings?.("developer")}>Open</Btn>
      </Ctl>
    </Sec>
  );
}

/** Risky switches that are on, by name. */
function risky(config: Config): string[] {
  return [
    config.get("gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback") === true ? "Trust the Host header for origins" : "",
    config.get("gateway.controlUi.dangerouslyDisableDeviceAuth") === true ? "Browser sign-in without a paired device" : "",
  ].filter(Boolean);
}

function Origins({ config }: { config: Config }) {
  const raw = config.get("gateway.controlUi.allowedOrigins");
  const origins = Array.isArray(raw) ? raw.map(String) : [];
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!/^https?:\/\/[^\s/]+$/.test(v)) { setErr("Enter an address like https://branch.example.com."); return; }
    setErr(""); setDraft(""); void config.set("gateway.controlUi.allowedOrigins", [...origins, v]);
  };
  return (
    <Ctl title="Allowed browser addresses" sub="Default: the public address, if set." stack after={
      <div className="gw-x">
        <div className="gw-list">{origins.length ? origins.map((o) => <span key={o} className="chip6">{o}<button type="button" className="s2-x" aria-label={`Remove ${o}`} onClick={() => void config.set("gateway.controlUi.allowedOrigins", origins.filter((x) => x !== o))}>×</button></span>) : <small>None.</small>}</div>
        <Acts><input className="inp" aria-label="Allowed browser addresses: add" placeholder="https://branch.example.com" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><Btn sm onClick={add}>Add</Btn></Acts>
        {err ? <small className="s2-err" role="alert">{err}</small> : null}
      </div>
    } />
  );
}

function Exposure({ config }: Ctx) {
  const hsts = config.get("gateway.http.securityHeaders.strictTransportSecurity");
  const on = risky(config);
  return (
    <Sec title="Exposure" group="Connection" showHeading={false}>
      <Ctl title="Accept files and pictures" sub="Off refuses every upload, even from old windows; downloads still work.">
        <Switch label="Accept files and pictures" checked={config.get("gateway.uploads.enabled") !== false} disabled={config.loading} onChange={(v) => void config.set("gateway.uploads.enabled", v)} />
      </Ctl>
      <Ctl title="HSTS header" sub="Only for an https address you control.">
        <Field label="HSTS header" value={typeof hsts === "string" ? hsts : ""} placeholder="max-age=31536000" onCommit={(v) => void config.set("gateway.http.securityHeaders.strictTransportSecurity", v.trim() || null)} />
      </Ctl>
      <h3 className="s2-h3">Risky switches</h3>
      <p className="hint gw-tight">{on.length ? `On: ${on.join(", ")}.` : "No risky switches are on."}</p>
      <h3 className="s2-h3">HTTPS and browser addresses</h3>
      <Ctl title="HTTPS for the Gateway" sub="Branch can make its own certificate for HTTPS." help="Off until you choose: it needs a certificate; Branch can make a self-signed one. Renewed certificate files are picked up without dropping connections.">
        <Switch label="HTTPS for the Gateway" checked={config.get("gateway.tls.enabled") === true} disabled={config.loading} onChange={(v) => void config.set("gateway.tls", v ? { enabled: true, autoGenerate: true } : { enabled: false })} />
      </Ctl>
      <Origins config={config} />
      <Ctl title="Trust the Host header for origins" sub="Unsafe: only for setups that rely on it.">
        <Switch label="Trust the Host header for origins" checked={config.get("gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback") === true} disabled={config.loading} onChange={(v) => void config.set("gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback", v)} />
      </Ctl>
    </Sec>
  );
}

function Limits({ config }: Ctx) {
  const rl = "gateway.auth.rateLimit";
  const secs = (key: string) => { const v = config.get(`${rl}.${key}`); return typeof v === "number" ? v / 1000 : undefined; };
  const attempts = config.get(`${rl}.maxAttempts`);
  return (
    <Sec title="Limits" group="Connection" showHeading={false}>
      <Ctl title="Wrong sign-ins allowed" sub="Within the time below, from one address."><Num label="Wrong sign-ins allowed" value={typeof attempts === "number" ? attempts : undefined} placeholder="10" min={1} onCommit={(v) => void config.set(`${rl}.maxAttempts`, v)} /></Ctl>
      <Ctl title="per" id="per"><Num label="per" unit="s" value={secs("windowMs")} placeholder="60" min={1} onCommit={(v) => void config.set(`${rl}.windowMs`, v === null ? null : v * 1000)} /></Ctl>
      <Ctl title="Then lock that address for"><Num label="Then lock that address for" unit="s" value={secs("lockoutMs")} placeholder="300" min={1} onCommit={(v) => void config.set(`${rl}.lockoutMs`, v === null ? null : v * 1000)} /></Ctl>
      <Ctl title="Never lock out this computer" sub="Keeps the terminal and this window from being locked out." help="So the terminal and this window can’t be locked out; browser pages are still limited.">
        <Switch label="Never lock out this computer" checked={config.get(`${rl}.exemptLoopback`) !== false} disabled={config.loading} onChange={(on) => void config.set(`${rl}.exemptLoopback`, on)} />
      </Ctl>
    </Sec>
  );
}

function Previews() {
  return (
    <Sec title="App previews">
      <Ctl title="Reach previews from other devices" sub="Previews show on this computer only. Changing it restarts the gateway." off="Needs the engine’s preview server settings.">
        <Seg label="Reach previews from other devices" value="here" onChange={() => undefined} options={[{ id: "here", label: "Directly" }, { id: "tailscale", label: "Private Tailscale" }, { id: "own", label: "My own address" }]} />
      </Ctl>
    </Sec>
  );
}

/** A labelled input under "Another computer" that saves on blur; secrets are written but never read back. */
function RemoteField({ label, value, placeholder, secret, onCommit }: { label: string; value: string; placeholder?: string; secret?: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="gw-fld"><span>{label}</span>
      <input className="inp" type={secret ? "password" : "text"} value={draft} placeholder={placeholder} autoComplete="off" spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (draft !== value) { onCommit(draft.trim()); if (secret) setDraft(""); } }} />
    </label>
  );
}

/** Another computer: config gateway.remote.* (how this Branch reaches a gateway on another computer). */
function Another({ config, lv }: Ctx) {
  const r = "gateway.remote";
  const ssh = str(config.get(`${r}.transport`)) === "ssh";
  const port = Number(config.get(`${r}.remotePort`)) || DEFAULT_PORT;
  const set = (k: string, v: unknown) => void config.set(`${r}.${k}`, v === "" ? null : v);
  return (
    <Sec title="Another computer">
      <Ctl title="How to reach it" sub={ssh ? `Branch opens and keeps the tunnel itself, to that computer’s gateway port (${port} unless changed).` : undefined}>
        <Seg label="How to reach it" value={ssh ? "ssh" : "direct"} disabled={config.loading} onChange={(v) => set("transport", v)} options={[{ id: "direct", label: "Tailscale or my network" }, { id: "ssh", label: "Over SSH" }]} />
      </Ctl>
      <div className="gw-remote">
        {ssh ? <RemoteField label="SSH address" value={str(config.get(`${r}.sshTarget`))} placeholder="you@desk-pc or you@desk-pc:2222" onCommit={(v) => set("sshTarget", v)} />
          : <><RemoteField label="Its address" value={str(config.get(`${r}.url`))} placeholder="wss://desk-pc.tailnet.ts.net" onCommit={(v) => set("url", v)} /><p className="hint gw-tight">Use wss:// when it sits behind HTTPS or Tailscale Serve.</p></>}
        <RemoteField label="Its gateway key" value="" placeholder={config.get(`${r}.token`) !== undefined ? "Saved" : ""} secret onCommit={(v) => { if (v) set("token", v); }} />
        <p className="hint gw-tight">A password works too. It is kept in Branch’s settings and never shown here again.</p>
        {lv >= 2 ? (
          <>
            <RemoteField label="Certificate fingerprint" value={str(config.get(`${r}.tlsFingerprint`))} placeholder="Pinned on first use" onCommit={(v) => set("tlsFingerprint", v)} />
            <p className="hint gw-tight">Pins a wss:// address. Left empty, Branch pins it on first use, and only after the system already trusts the certificate; a self-signed one needs it filled in, or SSH.</p>
            <Ctl title="Check the SSH host key">
              <Seg label="Check the SSH host key" value={str(config.get(`${r}.sshHostKeyPolicy`)) || "strict"} disabled={config.loading} onChange={(v) => set("sshHostKeyPolicy", v)} options={[{ id: "strict", label: "Strictly" }, { id: "openssh", label: "As my SSH settings say" }]} />
            </Ctl>
            <Ctl title="Sign in through a proxy" sub="A sign-in proxy in front of that computer says who you are." off="The proxy’s headers are set in Infrastructure settings (gateway.remote.edgeAuth).">
              <Switch label="Sign in through a proxy" checked={config.get(`${r}.edgeAuth`) !== undefined} onChange={() => undefined} />
            </Ctl>
          </>
        ) : null}
        <Acts><Btn pri sm disabled title="Connects from the Branch app on your computer.">Connect</Btn></Acts>
      </div>
    </Sec>
  );
}

/** The chat-app sections: what the engine has is a copy row; the rest says where it lives or why not. */
function ChatApps({ lv }: { lv: number }) {
  const demo = "Needs the engine’s chat-app records.";
  return (
    <>
      <Sec title="Chat apps, more" group="Chat apps">
        <Ctl title="Pause a chat app from the chat" sub="/pause and /resume in that app." off="Pausing from the chat needs the engine’s chat command."><Switch label="Pause a chat app from the chat" checked={false} onChange={() => undefined} /></Ctl>
      </Sec>
      {lv >= 2 ? (
        <Sec title="From scripts" group="Connection" showHeading={false}>
          <CodeRow title="Send a message" code={'branch message send --channel telegram --target @me --message "Backup done"'} sub="From any script or scheduled job." />
          <CodeRow title="Connect a chat app" code="branch channels add --channel telegram --token <token>" sub="In one command." />
          <CodeRow title="Send to several chats" code={'branch message broadcast --targets telegram:@me slack:channel:C123 --message "Backup done"'} sub="Each target gets it; any that fails is named." />
          <CodeRow title="Ask a poll" code={'branch message poll --channel telegram --target @team --poll-question "Lunch?" --poll-option Pizza --poll-option Sushi'} sub="2 to 12 options, in the chat apps that have polls." />
          <CodeRow title="Everything else in a chat" code="branch message --help" sub="Reply, react, edit and pin through a chat app." help="Reply, react, edit, pin, threads and more, per chat app. Add --dry-run to see it first." />
        </Sec>
      ) : null}
      <Sec title="Chat apps, even more" group="Chat apps" showHeading={false}>
        <Ctl title="Send files into chats" sub="A Trunk can reply with the file itself, not a link." off="Set per chat app in Chat apps."><Switch label="Send files into chats" checked onChange={() => undefined} /></Ctl>
        <Ctl title="Relay for chat-app accounts" sub="The relay delivers messages using your phone number." help="Your phone number passes through the relay to deliver messages and is never saved. Off until you choose: your number would go through the relay." off="Needs the engine’s chat relay."><Switch label="Relay for chat-app accounts" checked={false} onChange={() => undefined} /></Ctl>
        <Ctl title="Push to your phone and browser" sub="When a Trunk needs you and no chat app is set up." off="Set in Notifications."><Switch label="Push to your phone and browser" checked onChange={() => undefined} /></Ctl>
      </Sec>
      <Sec title="Never break" group="If it stops">
        <Ctl title="Canary, journal and rollback" sub="Tries changes on a copy and rolls back bad ones." help="Every change to how Branch runs is tried on a copy first; a bad one is rolled back by itself." off="Needs the engine’s change journal."><Btn sm>Open the journal</Btn></Ctl>
      </Sec>
      <Sec title="Chat apps, in depth" group="Chat apps" showHeading={false}>
        <Ctl title="Telegram, in depth" sub="Mentions in groups, long replies, live typing and approval buttons." off="Set per chat app in Chat apps."><Btn sm>See all</Btn></Ctl>
        <Ctl title="Messages that always arrive" sub="Retries outgoing messages until the chat app takes them." help="Every outgoing message is written down and tried again until the app takes it." off={demo}><Btn sm>See the record</Btn></Ctl>
        <Ctl title="Messages that didn’t get through" sub="Messages a chat app sent that failed after every retry." help="Messages a chat app sent that failed after every retry. Fix the cause, then send one through again." off="Listed from a terminal, below."><Btn sm>See them</Btn></Ctl>
        {lv >= 2 ? <CodeRow title="From a terminal" code="branch channels dead-letters list --channel telegram" sub="Add resubmit <id> to send one again." /> : null}
        <Ctl title="Voice notes from chat apps" sub="Transcribes Telegram and WhatsApp voice notes here." help="A voice note sent in Telegram or WhatsApp is turned into words on this computer." off="Set in Voice."><Btn sm>Show one</Btn></Ctl>
        <Ctl title="Send to several chats" sub="One message, or a daily digest, to several chats at once." off="From a terminal: From scripts."><Btn sm>Set up a digest</Btn></Ctl>
        <Ctl title="Which Trunk answers" sub="Routes chat-app messages to the right Trunk." help="Rules that send a chat-app message to the right Trunk, or answer simple ones by themselves." off="Set per chat app in Chat apps (Who answers)."><Btn sm>See rules</Btn></Ctl>
        <Ctl title="Several Trunks in one chat" sub="Choose which Trunks answer a chat-app conversation." help="Pick a chat-app conversation and the Trunks that all answer it, each in its own conversation." off={demo}><Btn sm>Set up</Btn></Ctl>
        <Ctl title="Addresses for chat apps" sub="Each chat app reaches Branch at its own address." help="Each chat app reaches Branch at its own address. Change one if it leaks." off={demo}><Btn sm>See addresses</Btn></Ctl>
      </Sec>
    </>
  );
}
