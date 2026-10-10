// The status bar's popovers (DESIGN-SPEC §4.9.3–§4.9.8): Gateway, What each connection has left, Room left,
// Running in the background and the version menu. Each reads live engine facts.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Conversation } from "../connect/conversations";
import type { Level } from "../places-nav/settings-nav";
import { Icon, type IconName } from "./icons";
import { Popover, type Above } from "./Popover";
import { ageWords, comingUp, readLimits, readRoom, readRounds, sizeWords, uptimeWords, type LimitRow, type Limits, type Room, type Round, type UpdateInfo } from "./status-data";
import type { GatewayFacts } from "./use-status";
import "./status.css";
import { keyHint } from "./key-hint";
import { shownWhy } from "./shown-why";
import { branchVersionDetail, branchVersionLabel, isNewerBranchVersion } from "../connect/branch-version";
import { installOnComputer } from "../connect/desktop-component-updates";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type Base = { above: Above; onClose: () => void };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** One read when the popover opens; a late answer after it closes is dropped. */
function useRead<T>(request: Request, method: string | null, params: unknown, read: (r: unknown) => T): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!method) {
      return;
    }
    let live = true;
    request(method, JSON.parse(key)).then(
      (r) => live && setState({ data: read(r), error: null }),
      (e: unknown) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // `read` is a pure module-level reader; the request and its params decide the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, method, key]);
  return state;
}

function Item({ icon, label, hint, onClick, off, testid }: { icon: IconName; label: string; hint?: ReactNode; onClick?: () => void; off?: string; testid?: string }) {
  return (
    <button type="button" className="mi" role="menuitem" data-testid={testid} disabled={Boolean(off)} title={shownWhy(off)} onClick={onClick}>
      <Icon name={icon} small />
      <span className="mi-label">{label}</span>
      {hint ? <span className="mi-hint">{typeof hint === "string" ? keyHint(hint) : hint}</span> : null}
    </button>
  );
}

/** A control the engine can't back yet: greyed, with its reason under it (§5.1 "Disabled, with the reason"). */
function OffLine({ reason }: { reason: string }) {
  return shownWhy(reason) ? <p className="sp-off">{shownWhy(reason)}</p> : null;
}

const MODES = ["Off", "When needed", "On"] as const;

/** §4.9.3 Gateway: state line, Keep Branch running, What it has been doing, Restart the engine, Gateway settings…. */
export function GatewayPopover({ facts, level, onRestart, onSettings, ...base }: Base & { facts: GatewayFacts; level: Level; onRestart: () => void; onSettings: () => void }) {
  const up = facts.uptimeMs === null ? null : uptimeWords(facts.uptimeMs + (Date.now() - facts.connectedAt));
  const line = facts.health?.ok ? `On${up ? ` · up ${up}` : ""}` : facts.error ? `Offline · ${facts.error}` : "Checking…";
  return (
    <Popover at={{ x: 0, y: 0 }} label="Gateway" testid="pop-gateway" className="sp" {...base}>
      <div className="pt sp-title"><span>Gateway</span><small>{line}</small></div>
      <p className="pp">Keeps chat apps, your phone and automations working.</p>
      <div className="sp-mode">
        <span>Keep Branch running</span>
        <span className="seg sp-seg" role="radiogroup" aria-label="Keep Branch running" aria-disabled="true" style={{ gridTemplateColumns: "repeat(3, 1fr)", ["--i" as string]: facts.health?.ok ? 2 : 0, ["--n" as string]: 3 }}>
          {MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={m === "On" && Boolean(facts.health?.ok)} disabled>
              {m}
            </button>
          ))}
        </span>
      </div>
      <OffLine reason="The desktop app starts and stops the gateway; this window can't change it yet." />
      <p className="sp-health">{facts.health?.ok ? `Healthy · ${facts.health.durationMs != null ? `answered in ${facts.health.durationMs} ms` : "answered"}` : "Gateway has not answered yet"}</p>
      {level === "technical" && facts.health ? <p className="sp-note">Checked {ageWords(facts.health.checkedAt, Date.now())}</p> : null}
      <hr className="msep" />
      <Item icon="retry" label="Restart the engine" testid="gw-restart" onClick={onRestart} off={facts.health ? undefined : "Connect to the engine first."} />
      <Item icon="gear" label="Gateway settings…" testid="gw-settings" onClick={onSettings} />
    </Popover>
  );
}

function providerDot(row: LimitRow): string {
  const raw = `${row.provider ?? ""} ${row.name}`.toLowerCase();
  if (raw.includes("anthropic") || raw.includes("claude")) {
    return "anthropic";
  }
  if (raw.includes("openai") || raw.includes("codex") || raw.includes("chatgpt")) {
    return "openai";
  }
  return (row.provider ?? "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function accountRow(row: LimitRow) {
  const fiveHour = row.windows.find((window) => /5-hour/i.test(window.name)) ?? row.windows[0];
  const week = row.windows.find((window) => /week/i.test(window.name));
  const used = fiveHour ? Math.max(0, 100 - fiveHour.left) : 0;
  const weekUsed = week ? Math.max(0, 100 - week.left) : null;
  const left = fiveHour ? `${fiveHour.left}% left${fiveHour.reset ? ` · ${fiveHour.reset}` : ""}` : null;
  const label = row.email || row.name;
  const detail = [label === row.name ? null : row.name, row.plan, weekUsed === null ? null : `this week ${weekUsed}% used`].filter(Boolean).join(" · ");
  return { fiveHour, used, left, label, detail };
}

/** Every account is one flat list: provider dot, account, left · reset, meter, name · plan · this week. */
export function UsagePopover({ limits, request, onOpenUsage, ...base }: Base & { limits: Limits | null; request: Request; onOpenUsage: () => void }) {
  const [checked, setChecked] = useState<Limits | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  useEffect(() => setChecked(null), [limits]);
  const data = checked ?? limits;
  const rows = data?.rows ?? [];
  const check = useCallback((refreshAuth = true) => {
    setChecking(true);
    setCheckError(null);
    (refreshAuth ? request("models.authStatus", { refresh: true }) : Promise.resolve())
      .then(() => request("usage.status", { refresh: true }))
      .then((result) => { setChecked(readLimits(result)); window.dispatchEvent(new Event("branch:usage-checked")); },
        (error: unknown) => setCheckError(error instanceof Error ? error.message : String(error)))
      .finally(() => setChecking(false));
  }, [request]);
  useEffect(() => { check(false); }, [check]);
  return (
    <Popover at={{ x: 0, y: 0 }} label="Every account" testid="pop-usage" className="sp sp-wide usePopT5" {...base}>
      <div className="lims">
        <div className="pt">Every account</div>
        {rows.map((row) => {
          const { fiveHour, used, left, label, detail } = accountRow(row);
          return <div className={`acctT5${row.stale ? " staleT5" : ""}`} key={row.id} style={{ cursor: "default" }}>
            <span className="aNameT5"><span className={`provT5 ${providerDot(row)}`} aria-hidden="true" /><span className="aLabelT5">{label}</span></span>
            {row.inUse ? <span className="pill ok">used next</span> : null}
            {left ? <span className="aLeftT5">{left}</span> : null}
            {fiveHour ? <span className="meterT5"><i style={{ width: `${Math.max(used, 1)}%` }} /></span> : null}
            {!fiveHour || row.stale ? <small className="aLineT5">{row.line}</small> : null}
            {detail ? <small>{detail}</small> : null}
          </div>;
        })}
        {!limits ? <p className="sp-note">Asking each connection…</p> : null}
        {data && !rows.length ? <p className="sp-note">{data.refreshing ? "Asking each connection…" : "No account reports a limit yet."}</p> : null}
        {checkError ? <p className="sp-note">Couldn’t check accounts right now. Branch will try again.</p> : null}
        <hr />
        <Item icon="retry" label={checking ? "Checking…" : "Check every account now"} testid="usage-check" onClick={() => check()} off={checking ? "Checking accounts now." : undefined} />
        <Item icon="gear" label="Accounts and usage…" testid="open-usage" onClick={onOpenUsage} />
      </div>
    </Popover>
  );
}

function Bars({ room, open }: { room: Room; open: boolean }) {
  return (
    <div className="bars sp-bars">
      {room.parts.map((p) => (
        <div key={p.name}>
          <div className="brow">
            <span>{p.name}</span>
            <span className="track">
              <u style={{ width: `${Math.min(100, p.share)}%` }} />
            </span>
            <span className="v">{Math.round(p.share)}%</span>
          </div>
          {open && p.entries.length ? (
            <details className="sp-entries">
              <summary>{p.entries.length} entries</summary>
              {p.entries.map((e) => (
                <div className="brow sm" key={e.name}>
                  <span title={e.name}>{e.name}</span>
                  <span />
                  <span className="v">{e.share < 1 ? "<1" : Math.round(e.share)}%</span>
                </div>
              ))}
            </details>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Rounds({ rounds, cachedShare }: { rounds: Round[]; cachedShare: number }) {
  const top = Math.max(1, ...rounds.map((r) => r.words));
  return (
    <div className="rounds15">
      <div className="r-h15">
        <b>Reused from cache</b>
        <small>{cachedShare}%</small>
      </div>
      <div className="r-bars15" role="img" aria-label="Tokens used in each round so far">
        {rounds.map((r, i) => (
          <i key={i} style={{ height: `${(r.words / top) * 100}%` }} title={`Round ${i + 1}: ${sizeWords(r.words)} tokens`}>
            <u style={{ height: `${r.words ? Math.min(100, (r.cached / r.words) * 100) : 0}%` }} />
          </i>
        ))}
      </div>
      <small className="r-k15">
        <span className="k-a15" />
        New <span className="k-b15" />
        Cached
      </small>
    </div>
  );
}

type RoomProps = Base & { request: Request; row: Conversation; level: Level; onTidy: (keepLast: boolean) => void };

/** §4.9.5 Room left: the free share, what fills it by part, Tidy up, and Round by round. */
export function RoomPopover({ request, row, level, onTidy, ...base }: RoomProps) {
  const target = { key: row.key, ...(row.agentId ? { agentId: row.agentId } : {}) };
  const usage = useRead(request, "sessions.usage", { ...target, limit: 1, includeContextWeight: true }, (r) => r);
  const series = useRead(request, "sessions.usage.timeseries", target, readRounds);
  const room = readRoom(row.totalTokens, row.contextTokens, usage.data);
  const used = room ? 100 - room.free : 0;
  return (
    <Popover at={{ x: 0, y: 0 }} label="Context" testid="pop-room" className="sp" {...base}>
      <div className="pt sp-title"><span>Context</span><small>{room ? `${room.free}% left` : "Not measured"}</small></div>
      <p className="pp">{room ? `${sizeWords(row.totalTokens)} of ${sizeWords(room.size)} tokens used in this conversation` : "The engine hasn't measured this conversation yet."}</p>
      {room && room.parts.length ? <Bars room={room} open={level !== "regular"} /> : null}
      {series.data && series.data.rounds.length ? <Rounds {...series.data} /> : null}
      <hr className="msep" />
      <Item icon="spark" label={used >= 90 ? "Tidy up this conversation · recommended" : "Tidy up this conversation"} testid="room-tidy" onClick={() => onTidy(false)} />
      {level !== "regular" ? <Item icon="book" label="Keep only the last 400 lines…" testid="room-keep400" onClick={() => onTidy(true)} /> : null}
    </Popover>
  );
}

type RunningProps = Base & { request: Request; working: { key: string; title: string; line: string; runIds?: string[] }[]; onOpen: (key: string) => void; onAutomations: () => void; onBackground: () => void; onPauseAll: () => void };

/** Running in the background is exactly the live run rows; scheduled jobs are separate. */
export function RunningPopover({ request, working, onOpen, onAutomations, onBackground, onPauseAll, ...base }: RunningProps) {
  const jobs = useRead(request, "cron.list", { limit: 200 }, (r) => comingUp(Array.isArray(rec(r).jobs) ? (rec(r).jobs as unknown[]) : []));
  const upcoming = jobs.data ?? [];
  return (
    <Popover at={{ x: 0, y: 0 }} label="Running in the background" testid="pop-running" className="sp" {...base}>
      {upcoming.length ? (
        <>
          <div className="ph">Coming up</div>
          {upcoming.map((j, i) => (
            <div className="mi info" key={i}>
              <Icon name="clock" small />
              <span className="mi-label">{j.name}</span>
              <span className="mi-hint">{j.when}</span>
            </div>
          ))}
        </>
      ) : null}
      <div className="pt sp-title"><span>Running in the background</span><small>{working.length}</small></div>
      {working.length ? null : <p className="sp-note" role="status">Nothing is running.</p>}
      {working.map((w) => (
        <button type="button" className="mi" key={w.key} onClick={() => onOpen(w.key)}>
          <span className="sp-spin"><Icon name="spin" small /></span>
          <span className="mi-text"><span>{w.title}</span><small className="mi-s">{w.line}</small></span>
        </button>
      ))}
      <hr className="msep" />
      <Item icon="plus" label="Start something in the background" hint={<kbd>/bg</kbd>} onClick={onBackground} />
      <Item icon="clock" label="Open Automations…" onClick={onAutomations} />
      <Item icon="pause" label="Pause all Trunks" onClick={onPauseAll} off={working.length ? undefined : "No Trunk is running."} />
    </Popover>
  );
}

type VersionProps = Base & { update: UpdateInfo | null; version: string; desktopPending?: string | null; autoApply?: boolean; desktopInstall?: boolean; computerName?: string; onWhatsNew: () => void; onInstall: () => void; onRemind: () => void };

/** §4.9.8 Version and update menu: what's ready, What's new, Install when idle, Remind me tomorrow. */
export function VersionPopover({ update, version, desktopPending, autoApply, desktopInstall, computerName = "", onWhatsNew, onInstall, onRemind, ...base }: VersionProps) {
  const latest = version.trim() && update?.latest && isNewerBranchVersion(update.latest, version) ? update.latest : null;
  return (
    <Popover at={{ x: 0, y: 0 }} label="Version and updates" testid="pop-version" className="sp" {...base}>
      {version.trim() && desktopPending && autoApply && isNewerBranchVersion(desktopPending, version) ? <><div className="pt">Update ready, applying when your Trunks finish</div><p className="pp">{branchVersionLabel(desktopPending)}</p></> : null}
      {latest ? (
        <>
          <div className="pt sp-title"><span>{branchVersionLabel(latest)} is ready</span><small>You have {branchVersionDetail(version)}</small></div>
          <p className="pp">{desktopInstall ? update?.waiting ?? "Installs by itself when nothing is running." : installOnComputer(computerName)}</p>
          {update?.notes.length ? (
            <ul className="steps-list sp-notes">
              {update.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <hr className="msep" />
          {desktopInstall ? <Item icon="down" label="Install when idle" testid="ver-install" onClick={onInstall} off={update?.installing ? update.waiting ?? "Installing now." : undefined} /> : null}
          <Item icon="book" label="What’s new" testid="ver-whatsnew" onClick={onWhatsNew} />
          <Item icon="clock" label="Remind me tomorrow" testid="ver-remind" onClick={onRemind} />
        </>
      ) : (
        <>
          <div className="pt">{update?.statusMessage ?? "Branch is up to date."}</div>
          <p className="pp">Branch {branchVersionDetail(version)}</p>
          <Item icon="book" label="What’s new" testid="ver-whatsnew" onClick={onWhatsNew} />
        </>
      )}
    </Popover>
  );
}
