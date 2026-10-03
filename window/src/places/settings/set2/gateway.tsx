// Settings › Gateway (DESIGN-SPEC §4.7.15): the gateway's state (health, system.info, presence), its reach and
// sign-in (config gateway.bind / port / auth / tailscale / controlUi), restarting it (gateway.restart.request),
// a live ping measured by this page, exposure and limits. Run mode, the tray and quitting belong to the Branch app.
import { useEffect, useRef, useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Field, Hint, Num, Page, Pick, Sec, Seg, Status, Switch, useConfig, type RowEntry } from "../kit";
import { list } from "../adapter";
import { CallLine, CodeRow, Kv, bytes, lvOf, rec, span, str, useCall, useLive, when, type RecordValue } from "./common";
import { Icon } from "../../../shell/icons";

const LEDE = "A small helper that keeps Branch running in the background, starts it again if it stops, and carries interrupted work on.";
const APP = "Set by the Branch app on this computer.";
const BIND = [{ id: "loopback", label: "This computer" }, { id: "lan", label: "My network" }, { id: "tailnet", label: "Tailscale" }, { id: "custom", label: "One address" }, { id: "auto", label: "Automatic" }];
const BIND_LINE: Record<string, string> = { loopback: "Only this computer.", lan: "Any device on your network.", tailnet: "Your Tailscale devices, and this computer.", custom: "One address you choose, and this computer.", auto: "This computer if it can, otherwise every network." };
const AUTH = [{ id: "token", label: "Session key" }, { id: "password", label: "Password" }, { id: "trusted-proxy", label: "Trusted proxy" }, { id: "none", label: "None" }];
const COLORS = ["teal", "amber", "purple", "coral", "pink", "blue", "green", "red", "grey"];
const DEFAULT_PORT = 18789;

export const ROWS: RowEntry[] = [
  ["Gateway", "Keep Branch running", 0], ["Carry on interrupted work by itself", "Keep Branch running", 0], ["Show the gateway in the tray", "Keep Branch running", 0],
  ["Ask before quitting while work runs", "Keep Branch running", 0], ["A terminal where the Gateway runs", "What it has been doing", 0],
  ["Who can reach the Gateway", "Reach", 1], ["Port", "Reach", 1], ["Sign-in", "Reach", 1], ["Through Cloudflare", "Reach", 1], ["Tailscale", "Reach", 1],
  ["Tailscale access", "Reach", 1], ["Serve Branch’s page to browsers", "Reach", 1], ["Label this computer", "How it’s reached", 1], ["Branch in your browser", "How it’s reached", 1],
  ["Web address path", "How it’s reached", 1], ["How to reach it", "Another computer", 1], ["Pause a chat app from the chat", "Chat apps, more", 1],
  ["Canary, journal and rollback", "Never break", 1], ["Apply settings changes", "Technical", 2], ["Only join a running Gateway", "Technical", 2],
  ["Accept files and pictures", "Exposure", 2], ["HSTS header", "Exposure", 2], ["HTTPS for the Gateway", "Exposure", 2], ["Allowed browser addresses", "Exposure", 2],
  ["Trust the Host header for origins", "Exposure", 2], ["Wrong sign-ins allowed", "Limits", 2], ["Then lock that address for", "Limits", 2],
].map(([title, sec, lv]) => ({ page: "gateway", title: String(title), sec: String(sec), lv: lv as 0 | 1 | 2 }));

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
      <Doing {...ctx} onCheck={() => void health.reload()} />
      {ctx.lv >= 2 ? <Connection {...ctx} /> : null}
      {ctx.lv >= 2 ? <Technical {...ctx} /> : null}
      {ctx.lv >= 2 ? <Exposure {...ctx} /> : null}
      {ctx.lv >= 2 ? <Limits {...ctx} /> : null}
      {ctx.lv >= 1 ? <ChatApps lv={ctx.lv} /> : null}
    </Page>
  );
}

function channelNames(health: RecordValue): string[] {
  const labels = rec(health.channelLabels);
  return Object.entries(rec(health.channels)).filter(([, v]) => rec(v).connected === true || rec(v).running === true).map(([id]) => str(labels[id]) || id);
}

function GatewayStatus({ health, sys, healthError }: Ctx) {
  if (healthError) return <Status tone="bad" title="The gateway isn’t answering">{healthError} Branch keeps trying; Restart the engine below if it stays this way.</Status>;
  if (!health.ok && !health.ts) return null;
  const up = span(sys.uptimeMs);
  const chats = channelNames(health);
  return (
    <Status title="The gateway is on">
      {`On.${up ? ` Up ${up}.` : ""}${chats.length ? ` ${chats.join(", ")} keep${chats.length === 1 ? "s" : ""} working when the window is closed.` : ""}`}
    </Status>
  );
}

function KeepRunning() {
  return (
    <Sec title="Keep Branch running">
      <Ctl title="Gateway" sub="Recommended: On. Telegram, your phone and automations keep working when the window is closed." off={APP}>
        <Seg label="Gateway" value="on" onChange={() => undefined} options={[{ id: "off", label: "Off" }, { id: "when-needed", label: "When needed" }, { id: "on", label: "On" }]} />
      </Ctl>
      <Ctl title="Carry on interrupted work by itself" sub="After a restart, safe steps carry on. Anything that sends or changes something asks you first." off="The engine carries safe steps on by itself; there is no switch for it."><Switch label="Carry on interrupted work by itself" checked onChange={() => undefined} /></Ctl>
      <Ctl title="Show the gateway in the tray" sub="A small Branch icon by the clock with Restart and Quit." off={APP}><Switch label="Show the gateway in the tray" checked onChange={() => undefined} /></Ctl>
      <Ctl title="Ask before quitting while work runs" sub="Quit asks first while a Trunk is working. Off until you choose: Branch quits at once." off={APP}><Switch label="Ask before quitting while work runs" checked={false} onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

function Reach({ config }: Ctx) {
  const bind = str(config.get("gateway.bind")) || "loopback";
  const port = config.get("gateway.port");
  const auth = str(config.get("gateway.auth.mode")) || "token";
  const ts = str(config.get("gateway.tailscale.mode")) || "off";
  return (
    <Sec title="Reach">
      <Ctl title="Who can reach the Gateway" sub={BIND_LINE[bind]}>
        <Seg label="Who can reach the Gateway" value={bind} disabled={config.loading} onChange={(v) => void config.set("gateway.bind", v)} options={BIND} />
      </Ctl>
      {bind === "custom" ? <Ctl title="The address"><Field label="The address" value={str(config.get("gateway.customBindHost"))} placeholder="192.168.1.20" onCommit={(v) => void config.set("gateway.customBindHost", v || null)} /></Ctl> : null}
      <Ctl title="Port" sub="One port for the window, phones and chat apps.">
        <Num label="Port" value={typeof port === "number" ? port : undefined} placeholder={String(DEFAULT_PORT)} min={1} max={65535} onCommit={(v) => void config.set("gateway.port", v)} />
      </Ctl>
      <Ctl title="Sign-in" sub="How people and apps prove who they are. Changing it restarts the Gateway.">
        <Pick label="Sign-in" value={auth} disabled={config.loading} onChange={(v) => void config.set("gateway.auth.mode", v)} options={AUTH} />
      </Ctl>
      <Ctl title="Through Cloudflare" sub="A public https address with Cloudflare sign-in in front. The Gateway stays on this computer and no port opens." off="Needs a Cloudflare tunnel set up outside Branch."><Btn sm>Set up</Btn></Ctl>
      <Ctl title="Tailscale" sub="Reach Branch from your other devices over Tailscale. Off until you choose: it opens Branch to other devices." off="Branch can’t read Tailscale’s state from this engine." />
      <Ctl title="Tailscale access" sub="Branch doesn’t set Tailscale up.">
        <Seg label="Tailscale access" value={ts} disabled={config.loading} onChange={(v) => void config.set("gateway.tailscale.mode", v)} options={[{ id: "off", label: "Off" }, { id: "serve", label: "My tailnet" }, { id: "funnel", label: "Public" }]} />
      </Ctl>
      <Ctl title="Serve Branch’s page to browsers" sub="The page at Branch’s address. Off keeps chat apps and devices working.">
        <Switch label="Serve Branch’s page to browsers" checked={config.get("gateway.controlUi.enabled") !== false} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.enabled", on)} />
      </Ctl>
    </Sec>
  );
}

function localAddress(config: Config, sys: RecordValue): string {
  const port = Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT;
  const base = str(config.get("gateway.controlUi.basePath")).replace(/^\/?/, "/").replace(/\/$/, "");
  return `http://127.0.0.1:${port}${base}/`;
}

function Reached({ config, sys, engine }: Ctx) {
  const presence = useLive<RecordValue>(engine, "presence.query", {}, ["presence"]);
  const env = rec(config.get("gateway.controlUi.environment"));
  const label = str(env.label);
  const color = str(env.color) || "teal";
  const page = config.get("gateway.controlUi.enabled") !== false;
  const devices = Number(rec(presence.data).totalDevices) || list(rec(presence.data).devices).length;
  const bind = BIND.find((b) => b.id === (str(config.get("gateway.bind")) || "loopback"))?.label ?? "This computer";
  return (
    <Sec title="How it’s reached">
      <Status title={`${bind} · ${label || str(sys.machineName) || "This computer"}`}>{presence.data ? `${devices} ${devices === 1 ? "app" : "apps"} connected` : "Connected apps not reported"}</Status>
      <Acts><Btn sm disabled={!page} title={page ? undefined : "Turn on Branch in your browser first."} onClick={() => window.open(localAddress(config, sys), "_blank", "noopener")}>Open in a browser</Btn></Acts>
      <Ctl title="Label this computer" sub="Off until you set a label: shows which computer a window talks to when you use more than one. 1 to 24 characters."
        after={label ? <span className="s2-swatches">{COLORS.map((c) => <button key={c} type="button" className={`s2-sw s2-sw-${c}`} aria-label={c} aria-pressed={c === color} onClick={() => void config.set("gateway.controlUi.environment", { label, color: c })} />)}</span> : null}>
        <Field label="Label this computer" value={label} placeholder="Desk" onCommit={(v) => void config.set("gateway.controlUi.environment", v.trim() ? { label: v.trim().slice(0, 24), color } : null)} />
      </Ctl>
      <Ctl title="Branch in your browser" sub="The gateway also shows this window to a browser on this computer, at the local address. Links Branch hands out open that page there. It works while the gateway runs.">
        <Switch label="Branch in your browser" checked={page} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.enabled", on)} />
      </Ctl>
      <Ctl title="Web address path" sub="Empty means the root of the local address. Changing it restarts the gateway.">
        <Field label="Web address path" value={str(config.get("gateway.controlUi.basePath"))} placeholder="/" onCommit={(v) => void config.set("gateway.controlUi.basePath", v.trim() || null)} />
      </Ctl>
    </Sec>
  );
}

function Doing({ engine, health, sys, onCheck }: Ctx & { onCheck: () => void }) {
  const restart = useCall();
  const started = typeof sys.uptimeMs === "number" ? Date.now() - Number(sys.uptimeMs) : undefined;
  const go = () => void restart.run(() => engine.request<RecordValue>("gateway.restart.request", { reason: "settings" }), (r) => (rec(r).status === "deferred" ? "Restarting once the running work finishes." : "Restarting. The window reconnects by itself."));
  return (
    <Sec title="What it has been doing">
      <ol className="s2-tl">
        {started ? <li className="ok"><span>Started<small>{when(started)}</small></span></li> : null}
        {health.ts ? <li className="ok"><span>Health check<small>{typeof health.durationMs === "number" ? `Answered in ${health.durationMs} ms` : "Answered"} {when(health.ts)}</small></span></li> : null}
      </ol>
      <Acts><Btn onClick={go} disabled={restart.busy}><Icon name="retry" small />Restart the engine</Btn><Btn ghost onClick={onCheck}>Check again</Btn></Acts>
      <CallLine call={restart} />
      <Ctl title="A terminal where the Gateway runs" sub="Opens a terminal on the Gateway’s computer: in WSL on this PC, or over SSH on another computer." off="Open it from a conversation’s side panel (Terminal)."><Btn sm>Open terminal</Btn></Ctl>
    </Sec>
  );
}

/** Connection (Technical): a ping this page measures every 5 s while it is open, and the gateway's own load. */
function usePing(engine: SettingsPageProps["engine"]) {
  const [pings, setPings] = useState<number[]>([]);
  const [missed, setMissed] = useState(0);
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
    };
    void ping();
    const id = setInterval(() => void ping(), 5000);
    return () => { live = false; clearInterval(id); };
  }, [engine]);
  return { pings, missed };
}
function pct(sorted: number[], p: number): string { return sorted.length ? `${Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])} ms` : ""; }

function Connection({ engine, config, sys }: Ctx) {
  const { pings, missed } = usePing(engine);
  const sorted = [...pings].sort((a, b) => a - b);
  const mem = rec(sys.processMemory);
  const loop = rec(sys.eventLoop);
  return (
    <Sec title="Connection">
      <Kv rows={[["Connected to", `127.0.0.1:${Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT}`], ["Sign-in", AUTH.find((a) => a.id === (str(config.get("gateway.auth.mode")) || "token"))?.label.toLowerCase() ?? ""]]} />
      <h3 className="s2-h3">Gateway ping</h3>
      <Kv rows={[["Latest", pings.length ? `${Math.round(pings[pings.length - 1])} ms` : ""], ["Average", pings.length ? `${Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)} ms` : ""], ["p50", pct(sorted, 50)], ["p95", pct(sorted, 95)], ["p99", pct(sorted, 99)]]} />
      <Hint>Pings kept: {pings.length}/100{missed ? ` · ${missed} missed` : ""} · every 5 s while this page is open</Hint>
      <h3 className="s2-h3">Gateway activity</h3>
      <Hint>The Gateway’s own processor, memory and event-loop delay.</Hint>
      <Kv rows={[["Processor", typeof loop.cpuCoreRatio === "number" ? `${Math.round(Number(loop.cpuCoreRatio) * 100)}%` : ""], ["Memory", bytes(mem.rssBytes)], ["Event-loop delay", typeof loop.delayP99Ms === "number" ? `${Math.round(Number(loop.delayP99Ms))} ms` : ""], ["This computer", sys.uptimeMs ? `up ${span(sys.uptimeMs)}` : ""], ["Cores", sys.cpuCount ? `${str(sys.cpuCount)} cores${Array.isArray(sys.loadAverage) ? ` · load ${sys.loadAverage.map((n) => Number(n).toFixed(2)).join(" ")}` : ""}` : ""], ["Disk", sys.diskTotalBytes ? `${bytes(sys.diskAvailableBytes)} free of ${bytes(sys.diskTotalBytes)}` : ""], ["Node", sys.nodeVersion ? `${str(sys.nodeVersion)} · process ${str(sys.pid)}` : ""]]} />
    </Sec>
  );
}

function Technical({ config, sys, openSettings }: Ctx) {
  const reload = str(config.get("gateway.reload.mode")) || "hybrid";
  return (
    <Sec title="Technical">
      <Ctl title="Apply settings changes" sub="Live applies safe changes at once and restarts the Gateway when one needs it.">
        <Seg label="Apply settings changes" value={reload} disabled={config.loading} onChange={(v) => void config.set("gateway.reload.mode", v)} options={[{ id: "hybrid", label: "Live" }, { id: "off", label: "Only on restart" }]} />
      </Ctl>
      <Kv rows={[["mode", str(config.get("gateway.mode")) || "local"], ["Address", `${str(config.get("gateway.bind")) || "loopback"} : ${Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT}`], ["Sign-in", AUTH.find((a) => a.id === (str(config.get("gateway.auth.mode")) || "token"))?.label ?? ""], ["Process", str(sys.pid)]]} />
      <Ctl title="Only join a running Gateway" sub="For people who run the Gateway themselves. Off until you choose: nothing keeps Branch running when the window closes." off={APP}><Switch label="Only join a running Gateway" checked={false} onChange={() => undefined} /></Ctl>
      <Ctl title="Infrastructure settings" sub="Every setting for the Gateway, the browser, computers that join, finding computers nearby and the agent protocol.">
        <Btn sm disabled={!openSettings} onClick={() => openSettings?.("developer")}>Open</Btn>
      </Ctl>
    </Sec>
  );
}

function Exposure({ config }: Ctx) {
  const raw = config.get("gateway.controlUi.allowedOrigins");
  const origins = Array.isArray(raw) ? raw.map(String) : [];
  const [draft, setDraft] = useState("");
  const hsts = config.get("gateway.http.securityHeaders.strictTransportSecurity");
  return (
    <Sec title="Exposure">
      <Ctl title="Accept files and pictures" sub="Off refuses every upload, even from old windows; downloads still work.">
        <Switch label="Accept files and pictures" checked={config.get("gateway.uploads.enabled") !== false} disabled={config.loading} onChange={(on) => void config.set("gateway.uploads.enabled", on)} />
      </Ctl>
      <Ctl title="HSTS header" sub="Only for an https address you control.">
        <Field label="HSTS header" value={typeof hsts === "string" ? hsts : ""} placeholder="max-age=31536000" onCommit={(v) => void config.set("gateway.http.securityHeaders.strictTransportSecurity", v.trim() || null)} />
      </Ctl>
      <h3 className="s2-h3">HTTPS and browser addresses</h3>
      <Ctl title="HTTPS for the Gateway" sub="Off until you choose: it needs a certificate; Branch can make a self-signed one. Renewed certificate files are picked up without dropping connections.">
        <Switch label="HTTPS for the Gateway" checked={config.get("gateway.tls.enabled") === true} disabled={config.loading} onChange={(on) => void config.set("gateway.tls", on ? { enabled: true, autoGenerate: true } : { enabled: false })} />
      </Ctl>
      <Ctl title="Allowed browser addresses" sub="Default: the public address, if set." stack after={
        <div className="s2-list">
          {origins.length ? origins.map((o) => <span key={o} className="chip6">{o}<button type="button" className="s2-x" aria-label={`Remove ${o}`} onClick={() => void config.set("gateway.controlUi.allowedOrigins", origins.filter((x) => x !== o))}>×</button></span>) : <small>None.</small>}
          <Acts><input className="inp" aria-label="Add a browser address" placeholder="https://branch.example.com" value={draft} onChange={(e) => setDraft(e.target.value)} /><Btn sm disabled={!/^https?:\/\/[^\s/]+$/.test(draft.trim())} onClick={() => { void config.set("gateway.controlUi.allowedOrigins", [...origins, draft.trim()]); setDraft(""); }}>Add</Btn></Acts>
        </div>
      } />
      <Ctl title="Trust the Host header for origins" sub="Unsafe: only for setups that rely on it.">
        <Switch label="Trust the Host header for origins" checked={config.get("gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback") === true} disabled={config.loading} onChange={(on) => void config.set("gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback", on)} />
      </Ctl>
    </Sec>
  );
}

function Limits({ config }: Ctx) {
  const rl = "gateway.auth.rateLimit";
  const secs = (key: string) => { const v = config.get(`${rl}.${key}`); return typeof v === "number" ? v / 1000 : undefined; };
  const attempts = config.get(`${rl}.maxAttempts`);
  return (
    <Sec title="Limits">
      <Ctl title="Wrong sign-ins allowed" sub="Within the time below, from one address."><Num label="Wrong sign-ins allowed" value={typeof attempts === "number" ? attempts : undefined} placeholder="10" min={1} onCommit={(v) => void config.set(`${rl}.maxAttempts`, v)} /></Ctl>
      <Ctl title="per" id="per"><Num label="per" unit="s" value={secs("windowMs")} placeholder="60" min={1} onCommit={(v) => void config.set(`${rl}.windowMs`, v === null ? null : v * 1000)} /></Ctl>
      <Ctl title="Then lock that address for"><Num label="Then lock that address for" unit="s" value={secs("lockoutMs")} placeholder="300" min={1} onCommit={(v) => void config.set(`${rl}.lockoutMs`, v === null ? null : v * 1000)} /></Ctl>
      <Ctl title="Don’t limit this computer" sub="Sign-ins from this computer never lock it out.">
        <Switch label="Don’t limit this computer" checked={config.get(`${rl}.exemptLoopback`) !== false} disabled={config.loading} onChange={(on) => void config.set(`${rl}.exemptLoopback`, on)} />
      </Ctl>
    </Sec>
  );
}

/** Another computer and the chat-app sections: what the engine has is a copy row; the rest says where it lives or why not. */
function ChatApps({ lv }: { lv: number }) {
  const demo = "Needs the engine’s chat-app records.";
  return (
    <>
      <Sec title="Another computer">
        <Ctl title="How to reach it" off="Switch to another computer’s Branch with the switcher at the top of the list." />
      </Sec>
      <Sec title="Chat apps, more">
        <Ctl title="Pause a chat app from the chat" sub="/pause and /resume in that app." off="Pausing from the chat needs the engine’s chat command."><Switch label="Pause a chat app from the chat" checked={false} onChange={() => undefined} /></Ctl>
      </Sec>
      {lv >= 2 ? (
        <Sec title="App previews">
          <Ctl title="Reach previews from other devices" sub="Previews show on this computer only. Changing it restarts the gateway." off="Needs the engine’s preview server settings.">
            <Seg label="Reach previews from other devices" value="here" onChange={() => undefined} options={[{ id: "here", label: "This computer" }, { id: "tailscale", label: "Private Tailscale" }, { id: "own", label: "My own address" }]} />
          </Ctl>
        </Sec>
      ) : null}
      {lv >= 2 ? (
        <Sec title="From scripts">
          <CodeRow title="Send to several chats" code={'branch message broadcast --targets telegram:@me slack:channel:C123 --message "Backup done"'} sub="Each target gets it; any that fails is named." />
          <CodeRow title="Ask a poll" code={'branch message poll --channel telegram --target @team --poll-question "Lunch?" --poll-option Pizza --poll-option Sushi'} sub="2 to 12 options, in the chat apps that have polls." />
          <CodeRow title="Everything else in a chat" code="branch message --help" sub="Reply, react, edit, pin, threads and more, per chat app. Add --dry-run to see it first." />
        </Sec>
      ) : null}
      <Sec title="Chat apps, even more">
        <Ctl title="Send files into chats" sub="A Trunk can reply with the file itself, not a link." off="Set per chat app in Chat apps."><Switch label="Send files into chats" checked onChange={() => undefined} /></Ctl>
        <Ctl title="Relay for chat-app accounts" sub="Your phone number passes through the relay to deliver messages and is never saved. Off until you choose: your number would go through the relay." off="Needs the engine’s chat relay."><Switch label="Relay for chat-app accounts" checked={false} onChange={() => undefined} /></Ctl>
        <Ctl title="Push to your phone and browser" sub="When a Trunk needs you and no chat app is set up." off="Set in Notifications."><Switch label="Push to your phone and browser" checked onChange={() => undefined} /></Ctl>
      </Sec>
      <Sec title="Never break">
        <Ctl title="Canary, journal and rollback" sub="Every change to how Branch runs is tried on a copy first; a bad one is rolled back by itself." off="Needs the engine’s change journal."><Btn sm>Open the journal</Btn></Ctl>
      </Sec>
      <Sec title="Chat apps, in depth">
        <Ctl title="Telegram, in depth" sub="Mentions in groups, long replies, live typing and approval buttons." off="Set per chat app in Chat apps."><Btn sm>See all</Btn></Ctl>
        <Ctl title="Messages that always arrive" sub="Every outgoing message is written down and tried again until the app takes it." off={demo}><Btn sm>See the record</Btn></Ctl>
        <Ctl title="Messages that didn’t get through" sub="Messages a chat app sent that failed after every retry. Fix the cause, then send one through again." off="Listed from a terminal, below." />
        <CodeRow title="From a terminal" code="branch channels dead-letters list --channel telegram" sub="Add resubmit <id> to send one again." />
        <Ctl title="Voice notes from chat apps" sub="A voice note sent in Telegram or WhatsApp is turned into words on this computer." off="Set in Voice."><Btn sm>Show one</Btn></Ctl>
        <Ctl title="Send to several chats" sub="One message, or a daily digest, to several chats at once." off="From a terminal: From scripts."><Btn sm>Set up a digest</Btn></Ctl>
        <Ctl title="Which Trunk answers" sub="Rules that send a chat-app message to the right Trunk, or answer simple ones by themselves." off="Set per chat app in Chat apps (Who answers)."><Btn sm>See rules</Btn></Ctl>
        <Ctl title="Several Trunks in one chat" sub="Pick a chat-app conversation and the Trunks that all answer it, each in its own conversation." off={demo}><Btn sm>Set up</Btn></Ctl>
        <Ctl title="Addresses for chat apps" sub="Each chat app reaches Branch at its own address. Change one if it leaks." off={demo}><Btn sm>See addresses</Btn></Ctl>
      </Sec>
    </>
  );
}
