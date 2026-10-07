// Setup › Two more things (DESIGN-SPEC §4.8.1.10 and its parity adds): email, bringing another assistant's memory
// along (migrations.memory.plan / apply), showing their conversations (the session catalogue plugins' switch),
// a backup, and a first routine (cron.add). Each tile reads or writes the engine; nothing finishes on a timer.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import { addParams, draftFromIdea } from "../places/automations/draft";
import { emptyForm } from "../places/automations/model";
import { saveConfig, type ConfigSnapshot } from "../places/settings/adapter";
import { MoveInDialog } from "../places/settings/set2/usage";
import { Icon, type IconName } from "../shell/icons";
import { ToolLogo } from "./tool-logos";
import { shownWhy } from "../shell/shown-why";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The assistants the session catalogue reads (Settings › Data & usage › Moving in and out). */
const CATALOGS = ["anthropic", "codex", "opencode"];
const catalogPath = (id: string) => `plugins.entries.${id}.config.sessionCatalog.enabled`;

export type Found = { providerId: string; label: string; fingerprint: string; items: string[] };

/** migrations.memory.plan: each assistant found on this computer with the items it would bring in. */
export function readFound(result: unknown): Found[] {
  return list(rec(result).providers)
    .filter((p) => p.found === true)
    .map((p) => ({ providerId: str(p.providerId), label: str(p.label) || str(p.providerId), fingerprint: str(p.planFingerprint), items: list(p.items).filter((i) => i.status === "planned").map((i) => str(i.id)) }))
    .filter((p) => p.items.length > 0);
}

const names = (found: Found[]) => (found.length > 1 ? `${found.slice(0, -1).map((f) => f.label).join(", ")} and ${found[found.length - 1].label}` : (found[0]?.label ?? ""));

function Tile({ icon, title, pill, line, children, className }: { icon: IconName; title: string; pill?: string; line: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={className ? `tile ${className}` : "tile"}>
      <div className="th">
        <span className="ico-tile">
          <Icon name={icon} small />
        </span>
        <b>{title}</b>
        {pill ? <span className="ob-pill ok">{pill}</span> : null}
      </div>
      <p>{line}</p>
      {children}
    </div>
  );
}

function useCatalogs(engine: WindowEngine) {
  const [state, setState] = useState<{ installed: string[]; snap: ConfigSnapshot } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([engine.request("plugins.list", {}), engine.request<ConfigSnapshot>("config.get", {})]).then(
      ([plugins, snap]) => live && setState({ installed: list(rec(plugins).plugins).filter((p) => p.installed === true && CATALOGS.includes(str(p.id))).map((p) => str(p.id)), snap }),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [engine]);
  const entries = rec(rec(rec(state?.snap.config).plugins).entries);
  // Preview otherConvPF18 / readNativeSessionCatalogPreference: unset is off, not on.
  const preference = (id: string, from: Record<string, unknown> = entries) => {
    const enabled = rec(rec(rec(from[id]).config).sessionCatalog).enabled;
    return typeof enabled === "boolean" ? enabled : undefined;
  };
  const on = (id: string) => preference(id) === true;
  const checked = Boolean(state?.installed.length) && Boolean(state?.installed.every(on));
  const set = async (value: boolean) => {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const snap = await saveConfig(engine, state.snap, Object.fromEntries(state.installed.map((id) => [catalogPath(id), value])));
      setState({ ...state, snap });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  // Leaving the step unticked writes enabled: false only where the person hasn't chosen yet.
  useEffect(() => {
    if (!state?.installed.length) return;
    const unset = state.installed.filter((id) => preference(id, rec(rec(rec(state.snap.config).plugins).entries)) === undefined);
    if (!unset.length) return;
    let live = true;
    setBusy(true);
    setError(null);
    saveConfig(engine, state.snap, Object.fromEntries(unset.map((id) => [catalogPath(id), false]))).then(
      (snap) => live && setState({ installed: state.installed, snap }),
      (e: unknown) => live && setError(message(e)),
    ).finally(() => { if (live) setBusy(false); });
    return () => {
      live = false;
    };
  }, [engine, state]);
  return { ready: Boolean(state), any: Boolean(state?.installed.length), checked, set, busy, error };
}

function BringTile({ engine, agentId, trunkName }: { engine: WindowEngine; agentId: string; trunkName: string }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seeing, setSeeing] = useState(false);
  const catalogs = useCatalogs(engine);
  useEffect(() => {
    let live = true;
    engine.request("migrations.memory.plan", { agentId }).then(
      (r) => live && setFound(readFound(r)),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [engine, agentId]);
  const bring = async () => {
    setBusy(true);
    setError(null);
    let brought = 0;
    try {
      for (const f of found ?? []) {
        const r = rec(await engine.request("migrations.memory.apply", { idempotencyKey: crypto.randomUUID(), agentId, providerId: f.providerId, planFingerprint: f.fingerprint, itemIds: f.items }));
        brought += Number(rec(r.summary).migrated) || 0;
      }
      setDone(brought);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const line = error ? error : !found ? "Looking for other assistants on this computer…" : done !== null ? `Brought in ${done} from ${names(found)}. ${trunkName} reads it from now on.` : found.length ? `Branch found memory from ${names(found)}. Bring it into ${trunkName}?` : "Branch found no other assistant's memory on this computer.";
  return (
    <Tile icon="chat" title="Bring your other assistant along" pill={done !== null ? "Brought in" : undefined} line={line} className="bringPF18">
      {found?.length && done === null && !skipped ? (
        <>
          <ul className="bring-lPF18">
            {found.map((f) => (
              <li key={f.providerId}>
                {f.label} · {f.items.length} ready to bring in
              </li>
            ))}
          </ul>
          <div className="acts">
            <button type="button" className="btn pri sm" data-testid="setup-bring" disabled={busy} onClick={() => void bring()}>
              {busy ? "Bringing it in…" : "Bring it in"}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setSkipped(true)}>
              Skip
            </button>
            <button type="button" className="link" onClick={() => setSeeing(true)}>
              See what comes in
            </button>
          </div>
        </>
      ) : null}
      <label className="chk">
        <input type="checkbox" data-testid="setup-otherconv" checked={catalogs.checked} disabled={!catalogs.ready || !catalogs.any || catalogs.busy} title={catalogs.ready && !catalogs.any ? "None of the plugins that read other assistants is installed." : undefined} onChange={(e) => void catalogs.set(e.target.checked)} />{" "}
        <span>
          Also show their conversations in Branch
          <small className="chk-sPF18">Claude Code, Codex and others on this computer. Shown, not copied; bring one in to keep it.</small>
        </span>
      </label>
      {catalogs.error ? <p className="ob-problem" role="alert">{catalogs.error}</p> : null}
      {seeing ? <MoveInDialog engine={engine} onClose={() => setSeeing(false)} /> : null}
    </Tile>
  );
}

function RoutineTile({ engine, agentId, trunkName }: { engine: WindowEngine; agentId: string; trunkName: string }) {
  const [text, setText] = useState("");
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    const task = text.trim();
    if (!task) return;
    setBusy(true);
    setError(null);
    try {
      const draft = { ...draftFromIdea(task, task, agentId), form: { ...emptyForm(), repeat: "weekdays" as const, time: "09:00" } };
      await engine.request("cron.add", addParams(draft));
      setAdded(task);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile
      icon="clock"
      title="A boring task to take off your plate"
      pill={added ? "Added" : undefined}
      line={
        added ? (
          <>
            Added to Automations: <b>{added}</b> · weekdays at 9:00 AM · {trunkName}. Change it any time in Automations › Scheduled.
          </>
        ) : (
          "One thing you do every week that a Trunk could do. It becomes your first automation."
        )
      }
    >
      {added ? null : (
        <form className="formR418" onSubmit={(e) => (e.preventDefault(), void add())}>
          <input className="inp" aria-label="A boring task" placeholder="Sort the receipts in Downloads" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn sm" data-testid="setup-routine" disabled={busy || !text.trim()}>
            Make it an automation
          </button>
        </form>
      )}
      {error ? <p className="ob-problem" role="alert">{error}</p> : null}
    </Tile>
  );
}

export function MoreBody({ engine, agentId, trunkName }: { engine: WindowEngine; agentId: string | null; trunkName: string }) {
  const off = (label: string, reason: string, logo: ReactNode) => (
    <button type="button" className="btn sm" disabled title={shownWhy(reason)}>
      {logo}
      {label}
    </button>
  );
  return (
    <div className="ob-two15">
      <Tile icon="mail" title="Email and calendar" line="So Trunks can find invoices, draft replies and see when you’re free. They still ask before sending.">
        <div className="acts">
          {off("Outlook", "Signing in to Outlook from setup isn't in the engine yet.", <ToolLogo id="outlook" size={16} />)}
          {off("Gmail", "Signing in to Gmail from setup isn't in the engine yet.", <ToolLogo id="gmail" size={16} />)}
        </div>
      </Tile>
      {agentId ? <BringTile engine={engine} agentId={agentId} trunkName={trunkName} /> : null}
      <Tile icon="clock" title="Bring back your Branch" line="Moving from another computer? Restore Trunks, memory and automations from a backup.">
        <div className="acts">{off("Choose a backup…", "Restoring a backup from the window isn't in the engine yet.", <Icon name="folder" small />)}</div>
      </Tile>
      {agentId ? <RoutineTile engine={engine} agentId={agentId} trunkName={trunkName} /> : null}
    </div>
  );
}
