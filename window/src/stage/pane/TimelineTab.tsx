import { useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import type { Level } from "../../places-nav/settings-nav";
import type { PlanStep } from "../computers";
import { SIcon, type StageIconName } from "../stage-icons";
import { money, summaryLine, timelineItems, timelineSummary, type TimelineItem, type TimelineKind } from "./pane-model";

const KIND_ICON: Record<TimelineKind, StageIconName> = { model: "spark", tool: "check", ok: "shield", help: "layers", you: "comment" };
const KIND_WORD: Record<TimelineKind, string> = { model: "Model call", tool: "Tool", ok: "Your rules", help: "Helper", you: "You" };

/** Where a block sits in the conversation; "Show it in the conversation" scrolls there when the thread marks it. */
// The thread wraps each item in `<div class="blk" data-block-keys="…">` (display: contents), so scroll to its child.
const blockEl = (key: string) =>
  typeof document === "undefined" ? null : (document.querySelector<HTMLElement>(`[data-block-keys~="${CSS.escape(key)}"]`)?.firstElementChild as HTMLElement | null) ?? null;

function StepCard({ item, index, count, name, level }: { item: TimelineItem; index: number; count: number; name: string; level: Level }) {
  const target = blockEl(item.key);
  const tokens = item.tokensIn !== undefined || item.tokensOut !== undefined ? `${(item.tokensIn ?? 0).toLocaleString()} tokens in, ${(item.tokensOut ?? 0).toLocaleString()} out` : "";
  return (
    <div className="tlat-pn" aria-live="polite">
      <div className="tla-h-pn">
        <b>
          At step {index + 1} of {count}
        </b>
        <span className="pill idle">{KIND_WORD[item.kind]}</span>
      </div>
      <h3>{item.title}</h3>
      <dl className="kv kv-pn">
        <dt>Who</dt>
        <dd>{item.kind === "you" ? "You" : name}</dd>
        {item.tech && level !== "regular" ? (
          <>
            <dt>Details</dt>
            <dd>{item.tech}</dd>
          </>
        ) : null}
        {item.at ? (
          <>
            <dt>At</dt>
            <dd>{new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</dd>
          </>
        ) : null}
        {item.cost !== undefined || tokens ? (
          <>
            <dt>Cost</dt>
            <dd>{[item.cost !== undefined ? money(item.cost) : "", level !== "regular" ? tokens : ""].filter(Boolean).join(" · ")}</dd>
          </>
        ) : null}
      </dl>
      {item.had ? (
        <p>
          <b>What it had</b>
          {item.had}
        </p>
      ) : null}
      {item.happened ? (
        <p>
          <b>What happened</b>
          {item.happened}
        </p>
      ) : null}
      <div className="acts-br">
        <button type="button" className="btn ghost sm" disabled={!target} title={target ? undefined : "This step isn't shown in the conversation right now."} onClick={() => blockEl(item.key)?.scrollIntoView({ block: "center", behavior: "smooth" })}>
          Show it in the conversation
        </button>
      </div>
    </div>
  );
}

/** Timeline: every step in order with a player and the selected step's card (who, details, when, cost). */
export function TimelineTab({ name, title, blocks, running, level }: { name: string; title: string; blocks: Block[]; running: boolean; level: Level }) {
  const items = useMemo(() => timelineItems(blocks, name), [blocks, name]);
  const summary = timelineSummary(items, running);
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const cur = at === null ? items.length - 1 : Math.min(at, items.length - 1);
  useEffect(() => {
    if (!playing) return;
    if (cur >= items.length - 1) {
      setPlaying(false);
      return;
    }
    // Replays the recorded steps one by one; it never makes up a step.
    const t = setTimeout(() => setAt(cur + 1), 1200);
    return () => clearTimeout(t);
  }, [playing, cur, items.length]);
  if (!items.length) return <p className="pane-empty">No recorded steps in this conversation.</p>;
  const item = items[cur]!;
  return (
    <div className="tl-wrap-pn">
      <div className="tlh-pn">
        <b>{title}</b>
        <small>{summaryLine(summary, running)}</small>
      </div>
      <div className="tlctl-pn">
        <button type="button" className="ib sm" aria-label="Step back" disabled={cur <= 0} onClick={() => setAt(Math.max(0, cur - 1))}>
          <SIcon name="first" small />
        </button>
        <button type="button" className="btn sm" aria-pressed={playing} onClick={() => { if (!playing && cur >= items.length - 1) setAt(0); setPlaying((p) => !p); }}>
          <SIcon name={playing ? "pause" : "play"} small />
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="ib sm" aria-label="Step forward" disabled={cur >= items.length - 1} onClick={() => setAt(cur + 1)}>
          <SIcon name="last" small />
        </button>
        <span className="tkrow-pn" role="group" aria-label="Steps">
          {items.map((it, i) => (
            <button key={it.key} type="button" className={`tk-pn k-${it.kind}${i === cur ? " on" : ""}${i > cur ? " later" : ""}`} aria-label={`Step ${i + 1}: ${it.title}`} onClick={() => { setPlaying(false); setAt(i); }} />
          ))}
        </span>
      </div>
      <StepCard item={item} index={cur} count={items.length} name={name} level={level} />
      <ol className="tll-pn">
        {items.map((it, i) => (
          <li key={it.key} className={`k-${it.kind}${i === cur ? " on" : ""}${i > cur ? " later" : ""}`}>
            <button type="button" onClick={() => { setPlaying(false); setAt(i); }}>
              <span className="tli-pn">
                <SIcon name={it.status === "running" ? "spin" : it.status === "failed" || it.status === "denied" ? "x" : KIND_ICON[it.kind]} small />
              </span>
              <span className="grow">
                <b>{it.title}</b>
                <small>{it.line}</small>
              </span>
              <span className="tlm-pn">{it.cost !== undefined ? money(it.cost) : ""}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Plan: the progress card as a plain checklist, done steps struck through. */
export function PlanTab({ steps, error }: { steps: PlanStep[]; error: string }) {
  if (!steps.length) return <p className="pane-empty">{error || "No plan for this conversation."}</p>;
  return (
    <ul className="plan-pn">
      {steps.map((s, i) => (
        <li key={i} className={s.state}>
          <span className="box-pn">{s.state === "done" ? <SIcon name="check" small /> : null}</span>
          <span>{s.text}</span>
        </li>
      ))}
    </ul>
  );
}

export type PathRow = { leafEntryId: string; headline: string; messageCount: number; updatedAt?: string; active: boolean };

/** The conversation's paths (sessions.branches.list); the pane shows a Branches tab when there are two or more. */
export function usePaths(engine: WindowEngine, revision: number): PathRow[] {
  const [paths, setPaths] = useState<{ owner: WindowEngine; rows: PathRow[] }>({ owner: engine, rows: [] });
  useEffect(() => {
    if (!engine.sessionKey) return;
    let live = true;
    engine.request<{ branches?: PathRow[] }>("sessions.branches.list", { sessionKey: engine.sessionKey }).then(
      (r) => live && setPaths({ owner: engine, rows: Array.isArray(r?.branches) ? r.branches : [] }),
      () => live && setPaths({ owner: engine, rows: [] }),
    );
    return () => {
      live = false;
    };
  }, [engine, revision]);
  return paths.owner === engine ? paths.rows : [];
}

/** Branches: each path the conversation took; switching makes one the path you're on (sessions.branches.switch). */
export function BranchesTab({ engine, paths, onSwitched, onError }: { engine: WindowEngine; paths: PathRow[]; onSwitched: () => void; onError: (m: string) => void }) {
  return (
    <ul className="paths-pn">
      {paths.map((p, i) => (
        <li key={p.leafEntryId} className={p.active ? "on" : undefined}>
          <span className="grow">
            <b>{p.headline || `Path ${i + 1}`}</b>
            <small>
              {p.messageCount} message{p.messageCount === 1 ? "" : "s"}
              {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
            </small>
          </span>
          {p.active ? (
            <span className="pill idle">You're on this one</span>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => engine.request("sessions.branches.switch", { sessionKey: engine.sessionKey, leafEntryId: p.leafEntryId }).then(onSwitched, (e: unknown) => onError(e instanceof Error ? e.message : String(e)))}>
              Switch to it
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
