// Settings › Remote access: the controls the R1 page draws itself (slots.ts controls), each on the engine calls Classic
// Gateway (set2/gateway.tsx) makes: the computer's label and colour and Branch in your browser (config), what the gateway
// has been doing (health, system.info, presence.query), Restart the engine (gateway.restart.request), the live ping and
// load, HTTPS, allowed browser addresses and the risky switches (config), and the From scripts commands.
import { useState, type ReactNode } from "react";
import { list, record, type RecordValue } from "../../../places/settings/adapter";
import { useConfig } from "../../../places/settings/kit";
import { bytes, span, str, useLive, when } from "../../../places/settings/set2/common";
import { AUTH, COLORS, DEFAULT_PORT, ago, channelNames, localAddress, pct, risky, usePing } from "../../../places/settings/set2/gateway";
import { Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";
import { copyAndSay } from "../../../shell/clipboard";
import { SCRIPT_CODE } from "./remote";

const Line = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <small className={"r1s-msg g-label" + (bad ? " r1s-bad" : "")} role={bad ? "status" : undefined} data-lines>{children}</small>;
const Val = ({ children }: { children: ReactNode }) => <span className="r1s-val g-label" data-lines>{children}</span>;
/** A button that keeps the attributes <Coming> gives it (data-need), so the control stays declared. */
const Btn = ({ children, disabled, onClick, ...rest }: { children: ReactNode; disabled?: boolean; onClick: () => void }) =>
  <button type="button" className="r1s-btn" disabled={disabled} onClick={onClick} {...rest}>{children}</button>;
const CFG = ["config.get", "config.patch"];
/** The label colours, as Classic Gateway paints them (gateway.css). */
const SWATCH: Record<string, string> = { teal: "#2F8C86", amber: "#C08A2A", purple: "#8A5AA8", coral: "#D8612A", pink: "#C2477A", blue: "#4F6FA8", green: "#5E8C4A", red: "#C0453A", grey: "var(--ink-3)" };
const kv = (rows: [string, string][]) => rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(" · ");

/** Label this computer, and its colour once it has a label (gateway.controlUi.environment). */
export function LabelComputer({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const [failed, run] = useFailure();
  const env = record(config.get("gateway.controlUi.environment"));
  const label = str(env.label);
  const color = str(env.color) || "teal";
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? label;
  const save = () => { if (draft === null || draft.trim() === label) return setDraft(null); const v = draft.trim(); setDraft(null); void run(() => config.set("gateway.controlUi.environment", v ? { label: v.slice(0, 24), color } : null)); };
  return <>
    <Needs engine={engine} need={CFG} where={row.label ?? ""}>
      <span className="r1s-own-ctl">
        <input className="r1s-inp" aria-label="Label this computer" maxLength={24} value={shown} placeholder="For example Staging" disabled={config.loading} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        <span role="radiogroup" aria-label="Label colour" className="r1s-acts">
          {COLORS.map((c) => <button key={c} type="button" role="radio" className="r1s-swatch" style={{ background: SWATCH[c] }} aria-label={c} aria-checked={Boolean(label) && c === color} disabled={!label} onClick={() => void run(() => config.set("gateway.controlUi.environment", { label, color: c }))} />)}
        </span>
      </span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Branch in your browser: the gateway serves this window at the local address; Open in browser opens it. */
export function BrowserPage({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const sys = record(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const [failed, run] = useFailure();
  const on = config.get("gateway.controlUi.enabled") !== false;
  return <>
    <Needs engine={engine} need={CFG} where={row.label ?? ""}>
      <span className="r1s-own-ctl">
        <Toggle label="Branch in your browser" on={on} disabled={config.loading} onChange={(v) => void run(() => config.set("gateway.controlUi.enabled", v))} />
        <button type="button" className="r1s-btn" data-local="" disabled={!on} onClick={() => window.open(localAddress(config, sys), "_blank", "noopener")}>Open in browser</button>
      </span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Lately: the gateway's state, when it started, its last health check and the connected apps. */
export function Lately({ engine, row }: SlotControlProps) {
  const health = useLive<RecordValue>(engine, "health", { probe: false }, ["health"]);
  const sys = record(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const presence = useLive<RecordValue>(engine, "presence.query", {}, ["presence"]);
  const h = record(health.data);
  const up = span(sys.uptimeMs);
  const chats = channelNames(h);
  const started = typeof sys.uptimeMs === "number" ? Date.now() - Number(sys.uptimeMs) : undefined;
  const devices = Number(record(presence.data).totalDevices) || list(record(presence.data).devices).length;
  const total = Object.keys(record(h.channels)).length;
  return (
    <Needs engine={engine} need={["health", "system.info"]} where={row.label ?? ""}>
      <div className="r1s-own-ctl">
        {health.error ? <Line bad>{`The gateway isn’t answering. ${health.error}`}</Line>
          : h.ok || h.ts ? <Line>{`On.${up ? ` Up ${up}.` : ""}${chats.length ? ` ${chats.join(", ")} keep${chats.length === 1 ? "s" : ""} working when the window is closed.` : ""}`}</Line> : null}
        <ul className="r1s-items">
          {started ? <li className="r1s-item"><span className="r1s-item-t g-label">Started</span><small className="g-label">{when(started)}</small></li> : null}
          {h.ts ? <li className="r1s-item"><span className="r1s-item-t g-label">Health check</span><small className="g-label">{`${typeof h.durationMs === "number" ? `Answered in ${(h.durationMs / 1000).toFixed(1)} s` : "Answered"} ${ago(h.ts)}`}</small></li> : null}
          {presence.data ? <li className="r1s-item"><span className="r1s-item-t g-label">{`${devices} ${devices === 1 ? "app" : "apps"} connected`}</span>{total ? <small className="g-label">{`Chat apps: ${chats.length} of ${total} working`}</small> : null}</li> : null}
        </ul>
      </div>
    </Needs>
  );
}

/** What the restart request answered, in plain words: a deferred restart waits for running work to end. */
const RESTART_SAID: Record<string, string> = {
  deferred: "Restart requested. Branch restarts when its current work ends.",
  scheduled: "Restart requested. Branch is restarting.",
  coalesced: "Restart requested. A restart is already on its way.",
};

/** Restart the engine (gateway.restart.request): deferred until running work finishes when the engine says so. The line
 *  under the button says what the engine answered, and shows only after the request succeeds. */
export function RestartEngine({ engine, row }: SlotControlProps) {
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setSaid(null);
    void run(async () => {
      const answer = await engine.request<{ status?: string }>("gateway.restart.request", { reason: "settings" });
      setSaid(RESTART_SAID[answer?.status ?? ""] ?? "Restart requested.");
    }).finally(() => setBusy(false));
  };
  return <>
    <Needs engine={engine} need={["gateway.restart.request"]} where={row.label ?? ""}><Btn disabled={busy} onClick={go}>Restart the engine</Btn></Needs>
    {said ? <small className="g-label" role="status">{said}</small> : null}
    <Failed text={failed} />
  </>;
}

/** Gateway address: the address this window is connected to, and how it signs in. */
export function GatewayAddress({ engine }: SlotControlProps) {
  const config = useConfig(engine);
  const sys = record(useLive<RecordValue>(engine, "system.info", {}, []).data);
  const address = engine.gatewayUrl?.replace(/[?#].*$/, "") || `ws://127.0.0.1:${Number(config.get("gateway.port")) || Number(sys.port) || DEFAULT_PORT}`;
  const auth = AUTH.find((a) => a.id === (str(config.get("gateway.auth.mode")) || "token"))?.label.toLowerCase() ?? "";
  return <><code className="r1s-val">{address}</code><Line>{`Sign-in: ${auth}.`}</Line></>;
}

/** Gateway ping: measured every 5 s while this page is open. */
export function Ping({ engine }: SlotControlProps) {
  const { pings, missed } = usePing(engine);
  const sorted = [...pings].sort((a, b) => a - b);
  return <><Val>{pings.length ? `${Math.round(pings[pings.length - 1])} ms` : "Connect to see the ping."}</Val>
    <Line>{kv([["Average", pings.length ? `${Math.round(pings.reduce((a, b) => a + b, 0) / pings.length)} ms` : ""], ["p50", pct(sorted, 50)], ["p95", pct(sorted, 95)], ["p99", pct(sorted, 99)]])}{` · kept ${pings.length}/100${missed ? ` · ${missed} missed` : ""}`}</Line></>;
}

/** Gateway activity: its processor, memory and event-loop delay, every 5 s. */
export function Activity({ engine }: SlotControlProps) {
  const { sys: polled } = usePing(engine);
  const sys = record(polled);
  const mem = record(sys.processMemory);
  const loop = record(sys.eventLoop);
  return <Line>{kv([["Processor", typeof loop.cpuCoreRatio === "number" ? `${Math.round(Number(loop.cpuCoreRatio) * 100)}%` : ""], ["Memory", bytes(mem.rssBytes)],
    ["Event-loop delay", typeof loop.delayP99Ms === "number" ? `${Math.round(Number(loop.delayP99Ms))} ms` : ""], ["This computer", sys.uptimeMs ? `up ${span(sys.uptimeMs)}` : ""],
    ["Cores", sys.cpuCount ? str(sys.cpuCount) : ""], ["Disk", sys.diskTotalBytes ? `${bytes(sys.diskAvailableBytes)} free of ${bytes(sys.diskTotalBytes)}` : ""],
    ["Node", sys.nodeVersion ? `${str(sys.nodeVersion)} · process ${str(sys.pid)}` : ""]]) || "Connect to see Branch’s activity."}</Line>;
}

/** Infrastructure settings: every engine setting lives on Developer. */
export function Infrastructure({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" disabled={!onPage} onClick={() => onPage?.("developer")}>Open</button>;
}

/** HTTPS for the Gateway: on asks for a certificate Branch makes itself (gateway.tls). */
export function Https({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={CFG} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label="HTTPS for Branch" on={config.get("gateway.tls.enabled") === true} disabled={config.loading}
        onChange={(v) => void run(() => config.set("gateway.tls", v ? { enabled: true, autoGenerate: true } : { enabled: false }))} /></span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Allowed browser addresses: a list with Remove on each, and Add (gateway.controlUi.allowedOrigins). */
export function Origins({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const [failed, run] = useFailure();
  const raw = config.get("gateway.controlUi.allowedOrigins");
  const origins = Array.isArray(raw) ? raw.map(String) : [];
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!/^https?:\/\/[^\s/]+$/.test(v)) { setErr("Enter an address like https://branch.example.com."); return; }
    setErr(""); setDraft(""); void run(() => config.set("gateway.controlUi.allowedOrigins", [...origins, v]));
  };
  return <>
    <Needs engine={engine} need={CFG} where={row.label ?? ""}>
      <div className="r1s-own-ctl">
        <ul className="r1s-items">{origins.length ? origins.map((o) => <li key={o} className="r1s-item"><span className="r1s-item-t g-label">{o}</span>
          <button type="button" className="r1s-link" aria-label={`Remove ${o}`} onClick={() => void run(() => config.set("gateway.controlUi.allowedOrigins", origins.filter((x) => x !== o)))}>Remove</button></li>) : <li className="r1s-item"><small className="g-label">None.</small></li>}</ul>
        <span className="r1s-acts">
          <input className="r1s-inp" aria-label="Allowed browser addresses" placeholder="https://branch.example.com" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button type="button" className="r1s-btn" onClick={add}>Add</button>
        </span>
      </div>
    </Needs>
    {err ? <Line bad>{err}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** The risky switches that are on, by name. */
export function Risky({ engine }: SlotControlProps) {
  const config = useConfig(engine);
  const on = risky(config);
  return <Line bad={on.length > 0}>{on.length ? `On: ${on.join(", ")}.` : "No risky switches are on."}</Line>;
}

/** A From scripts command, with Copy. */
export function ScriptCode({ row }: SlotControlProps) {
  const code = SCRIPT_CODE[row.id] ?? "";
  const [copied, setCopied] = useState(false);
  return <span className="r1s-own-ctl" data-local="">
    <code className="r1s-val">{code}</code>
    <Btn onClick={() => void copyAndSay(code).then(setCopied)}>{copied ? "Copied" : "Copy"}</Btn>
  </span>;
}
