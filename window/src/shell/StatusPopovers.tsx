// The status bar's popovers (DESIGN-SPEC §4.9.3–§4.9.8): Gateway, What each connection has left, Room left,
// Running in the background and the version menu. Each reads the engine; controls the engine has no method for are
// drawn greyed with the reason (WINDOW-BUILD-BRIEF "Hands off").
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "../places/settings/set1/service";
import type { Conversation } from "../connect/conversations";
import type { Level } from "../places-nav/settings-nav";
import { Icon, type IconName } from "./icons";
import { Popover, type Above } from "./Popover";
import { comingUp, limitsSummary, readMonthSpend, readRoom, readRounds, sizeWords, uptimeWords, monthParams, type Limits, type Room, type Round, type UpdateInfo } from "./status-data";
import type { GatewayFacts } from "./use-status";
import "./status.css";
import { shownWhy } from "./shown-why";
import { versionParts } from "../connect/branch-version";
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
      {hint ? <span className="mi-hint">{hint}</span> : null}
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
  const line = facts.health?.ok ? `On.${up ? ` Up ${up}.` : ""}` : facts.error ? `Can't reach the gateway: ${facts.error}` : "Checking the gateway…";
  return (
    <Popover at={{ x: 0, y: 0 }} label="Gateway" testid="pop-gateway" className="sp" {...base}>
      <div className="pt">Gateway</div>
      <p className="pp">{line}</p>
      <div className="row-in">
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
      <hr className="msep" />
      <div className="ph">What it has been doing</div>
      <div className="row-in sp-ev">
        <span>Health check</span>
        <small>{facts.health?.durationMs != null ? `Answered in ${facts.health.durationMs} ms` : facts.health ? "Answered" : "Not answered yet"}</small>
      </div>
      {level === "technical" && facts.uptimeMs !== null ? (
        <div className="row-in sp-ev">
          <span>Up</span>
          <small>{up}</small>
        </div>
      ) : null}
      <hr className="msep" />
      <Item icon="retry" label="Restart the engine" testid="gw-restart" onClick={onRestart} off={facts.health ? undefined : "Connect to the engine first."} />
      <Item icon="gear" label="Gateway settings…" testid="gw-settings" onClick={onSettings} />
    </Popover>
  );
}

function LimitBars({ row }: { row: Limits["rows"][number] }) {
  return (
    <>
      {row.windows.map((w, i) => (
        <div className="lim-w" key={i}>
          <span>{w.name}</span>
          <span className="lim-bar">
            <i style={{ width: `${w.left}%`, ...(w.low ? { background: "var(--warn)" } : {}) }} />
          </span>
          <span>
            {w.left}% left{w.reset ? ` · ${w.reset}` : ""}
          </span>
        </div>
      ))}
    </>
  );
}

/** §4.9.4 What each connection has left: one row per connection and account, then This month and Open Usage. */
export function UsagePopover({ limits, request, onOpenUsage, ...base }: Base & { limits: Limits | null; request: Request; onOpenUsage: () => void }) {
  const spend = useRead(request, "usage.cost", monthParams(), readMonthSpend);
  const rows = limits?.rows ?? [];
  return (
    <Popover at={{ x: 0, y: 0 }} label="What each connection has left" testid="pop-usage" className="sp sp-wide" {...base}>
      <div className="lims">
        <div className="ph">What each connection has left</div>
        {rows.map((row) => (
          <div className="lim" key={row.id}>
            <Logo id={row.id.split(":")[0] || row.name} name={row.name} size={28} />
            <div>
              <div className="lim-h">
                <b>{row.name}</b>
                {row.account ? <span className="muted">{row.account}</span> : null}
                <span className={row.pill === "Measured" ? "pill ok" : "pill idle"}>{row.pill}</span>
              </div>
              <LimitBars row={row} />
              <small>{row.line}</small>
            </div>
          </div>
        ))}
        {!limits ? <p className="sp-note">Asking each connection…</p> : null}
        {limits && !rows.length ? <p className="sp-note">{limits.refreshing ? "Asking each connection…" : "No connection reports a limit yet."}</p> : null}
        {rows.length ? <p className="sp-note">{limitsSummary(rows)}</p> : null}
        <div className="lim-foot">
          {spend.data ? (
            <span>
              This month: <b>{spend.data}</b>
            </span>
          ) : null}
          <span className="sb-spacer" />
          <button className="btn sm" type="button" data-testid="open-usage" onClick={onOpenUsage}>
            Open Usage
          </button>
        </div>
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
        <b>Round by round</b>
        <small>{cachedShare}% reused from the cache</small>
      </div>
      <div className="r-bars15" role="img" aria-label="Words used in each round so far">
        {rounds.map((r, i) => (
          <i key={i} style={{ height: `${(r.words / top) * 100}%` }} title={`Round ${i + 1}: ${sizeWords(r.words)} words`}>
            <u style={{ height: `${r.words ? Math.min(100, (r.cached / r.words) * 100) : 0}%` }} />
          </i>
        ))}
      </div>
      <small className="r-k15">
        <span className="k-a15" />
        new <span className="k-b15" />
        from the cache
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
    <Popover at={{ x: 0, y: 0 }} label="Room left in this conversation" testid="pop-room" className="sp" {...base}>
      <div className="pt">Room left in this conversation</div>
      <p className="pp">{room ? `${room.free}% of ${sizeWords(room.size)} words of context is free.` : "The engine hasn't measured this conversation yet."}</p>
      {room && room.parts.length ? <Bars room={room} open={level !== "regular"} /> : null}
      <hr className="msep" />
      <Item icon="spark" label={used >= 90 ? "Tidy up this conversation · recommended" : "Tidy up this conversation"} testid="room-tidy" onClick={() => onTidy(false)} />
      {level !== "regular" ? <Item icon="book" label="Keep only the last 400 lines…" testid="room-keep400" onClick={() => onTidy(true)} /> : null}
      {series.data && series.data.rounds.length ? <Rounds {...series.data} /> : null}
    </Popover>
  );
}

type RunningProps = Base & { request: Request; working: { key: string; title: string; line: string }[]; onOpen: (key: string) => void; onAutomations: () => void };

/** §4.9.6 Running in the background: Coming up, what runs now, and the two items. */
export function RunningPopover({ request, working, onOpen, onAutomations, ...base }: RunningProps) {
  const jobs = useRead(request, "cron.list", { limit: 200 }, (r) => comingUp(Array.isArray(rec(r).jobs) ? (rec(r).jobs as unknown[]) : []));
  return (
    <Popover at={{ x: 0, y: 0 }} label="Running in the background" testid="pop-running" className="sp" {...base}>
      {jobs.data && jobs.data.length ? (
        <>
          <div className="ph">Coming up</div>
          {jobs.data.map((j, i) => (
            <div className="mi info" key={i}>
              <Icon name="clock" small />
              <span className="mi-label">{j.name}</span>
              <span className="mi-hint">{j.when}</span>
            </div>
          ))}
          <Item icon="clock" label="Open Automations…" onClick={onAutomations} />
          <hr className="msep" />
        </>
      ) : null}
      <div className="ph">Running in the background</div>
      {working.length ? null : <p className="sp-note">Nothing is running.</p>}
      {working.map((w) => (
        <button type="button" className="mi" key={w.key} onClick={() => onOpen(w.key)}>
          <span className="sp-spin">
            <Icon name="spin" small />
          </span>
          <span className="mi-text">
            <span>{w.title}</span>
            <small className="mi-s">{w.line}</small>
          </span>
        </button>
      ))}
      <hr className="msep" />
      <Item icon="plus" label="Start something in the background" hint={<kbd>/bg</kbd>} off="Starting work in the background needs the engine's /bg command, which it doesn't have yet." />
      <Item icon="pause" label="Pause all Trunks" off="Pausing every Trunk needs an engine method it doesn't have yet." />
    </Popover>
  );
}

type VersionProps = Base & { update: UpdateInfo | null; version: string; desktopPending?: string | null; autoApply?: boolean; desktopInstall?: boolean; computerName?: string; onWhatsNew: () => void; onInstall: () => void; onRemind: () => void };

/** §4.9.8 Version and update menu: what's ready, What's new, Install when nothing is running, Remind me tomorrow. */
export function VersionPopover({ update, version, desktopPending, autoApply, desktopInstall, computerName = "", onWhatsNew, onInstall, onRemind, ...base }: VersionProps) {
  const latest = update?.latest && update.latest !== version ? update.latest : null;
  return (
    <Popover at={{ x: 0, y: 0 }} label="Version and updates" testid="pop-version" className="sp" {...base}>
      {desktopPending && autoApply ? <><div className="pt">Update ready, applying when your Trunks finish</div><p className="pp">Branch {versionParts(desktopPending).short}</p></> : null}
      {latest ? (
        <>
          <div className="pt">Branch {versionParts(latest).short} is ready</div>
          <p className="pp">{desktopInstall ? update?.waiting ?? "Installs when nothing is running and keeps a safety copy first." : installOnComputer(computerName)}</p>
          {update?.notes.length ? (
            <ul className="steps-list sp-notes">
              {update.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          ) : null}
          <Item icon="book" label="What’s new" testid="ver-whatsnew" onClick={onWhatsNew} />
          {desktopInstall ? <Item icon="check" label="Install when nothing is running" testid="ver-install" onClick={onInstall} off={update?.installing ? update.waiting ?? "Installing now." : undefined} /> : null}
          <Item icon="clock" label="Remind me tomorrow" testid="ver-remind" onClick={onRemind} />
        </>
      ) : (
        <>
          <div className="pt">{update?.statusMessage ?? "Branch is up to date."}</div>
          <p className="pp">Branch {versionParts(version).detail}</p>
          <Item icon="book" label="What’s new" testid="ver-whatsnew" onClick={onWhatsNew} />
        </>
      )}
    </Popover>
  );
}
