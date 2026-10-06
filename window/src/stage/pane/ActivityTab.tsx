import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import type { Level } from "../../places-nav/settings-nav";
import { resolveApproval } from "../../thread/actions";
import { useApprovalDetails, useHelpers, type ApprovalDetails, type Helper } from "../../thread/useEngineData";
import { needsYou } from "../../thread/Helpers";
import { Face } from "../../face/Face";
import { SIcon } from "../stage-icons";
import { activityRecordedAt, activityState, money } from "./pane-model";
import { shortReason, stepLabel } from "../../thread/format";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PROVIDER: Record<string, string> = { anthropic: "your Claude account", "openai-codex": "your ChatGPT account", openai: "your OpenAI account", google: "your Google account", ollama: "on this computer", lmstudio: "on this computer", local: "on this computer" };
const CARD_STATE: Record<string, string> = { triage: "New", backlog: "Later", todo: "To do", ready: "Ready", running: "Doing", doing: "Doing", review: "To check", blocked: "Stuck", done: "Done" };

/** The Canopy card this conversation works on (canopy.cards.list, matched by session key). */
function useCanopyCard(engine: WindowEngine): { title: string; status: string } | null {
  const [card, setCard] = useState<{ owner: WindowEngine; card: { title: string; status: string } | null }>({ owner: engine, card: null });
  useEffect(() => {
    let live = true;
    engine.request("canopy.cards.list", {}).then(
      (r) => {
        const hit = (Array.isArray(rec(r).cards) ? (rec(r).cards as unknown[]) : []).map(rec).find((c) => str(c.sessionKey) === engine.sessionKey);
        if (live) setCard({ owner: engine, card: hit ? { title: str(hit.title), status: str(hit.status) } : null });
      },
      () => live && setCard({ owner: engine, card: null }), // Canopy off: no card line.
    );
    return () => {
      live = false;
    };
  }, [engine]);
  return card.owner === engine ? card.card : null;
}

/** Each helper's model and provider (sessions.list rows) and its spend so far (sessions.usage). */
function useHelperFacts(engine: WindowEngine, helpers: Helper[]): Map<string, { line: string; cost?: number; job?: string; thinking?: string }> {
  const [facts, setFacts] = useState<{ owner: WindowEngine; signature: string; rows: Map<string, { line: string; cost?: number; job?: string; thinking?: string }> } | null>(null);
  const signature = JSON.stringify(helpers.map((h) => [h.key, h.parent, h.status, h.model, h.updatedAt]));
  useEffect(() => {
    let live = true;
    void Promise.all(
      helpers.map(async (h) => {
        const usage = await engine.request("sessions.usage", { key: h.key, range: "all" }).catch(() => null);
        const cost = rec(rec(usage).totals).totalCost;
        const rows = await engine.request("sessions.list", { spawnedBy: h.parent, limit: 200 }).catch(() => null);
        const row = (Array.isArray(rec(rows).sessions) ? (rec(rows).sessions as unknown[]) : []).map(rec).find((r) => r.key === h.key) ?? {};
        const provider = str(row.modelProvider);
        const line = [str(row.model) || h.model, PROVIDER[provider] ?? provider].filter(Boolean).join(" · ");
        const history = await engine.request("chat.history", { sessionKey: h.key, limit: 200 }).catch(() => null);
        const messages = (Array.isArray(rec(history).messages) ? rec(history).messages as unknown[] : []).map(rec);
        const contentText = (content: unknown, type: string) => typeof content === "string" && type === "text" ? content : (Array.isArray(content) ? content.map(rec).filter((part) => part.type === type).map((part) => str(type === "thinking" ? part.thinking : part.text)).filter(Boolean).join(" ") : "");
        const job = messages.map((m) => m.role === "user" ? contentText(m.content, "text") : "").find(Boolean);
        const thinking = messages.toReversed().map((m) => m.role === "assistant" ? contentText(m.content, "thinking") : "").find(Boolean);
        return [h.key, { line, ...(typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? { cost } : {}), ...(job ? { job } : {}), ...(thinking ? { thinking } : {}) }] as const;
      }),
    ).then((list) => live && setFacts({ owner: engine, signature, rows: new Map(list) }));
    return () => {
      live = false;
    };
    // Status/model changes under the same key must refresh measured facts too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, signature]);
  return facts?.owner === engine && facts.signature === signature ? facts.rows : new Map();
}

function HelperCard({ h, asks, facts, onStop, onAnswer }: { h: Helper; asks: ApprovalDetails[]; facts?: { line: string; cost?: number; job?: string; thinking?: string }; onStop: () => void; onAnswer: (id: string, d: "allow-once" | "deny") => void }) {
  const waiting = asks.length > 0;
  const working = h.status === "running" || h.status === "queued" || !h.status;
  const stalled = working && h.updatedAt && Date.now() - h.updatedAt > 10 * 60_000;
  const pill = waiting ? "Waiting for you" : stalled ? "No recent update" : working ? "Working" : h.status === "done" ? "Done" : "Stopped";
  return (
    <div className="hp-card-pn" role="listitem">
      <div className="hp-top-pn">
        <span className={`hp-mark-pn ${waiting || stalled ? "wait" : working ? "work" : h.status === "done" ? "done" : "stop"}`} aria-hidden="true">
          <SIcon name={waiting || stalled ? "info" : working ? "spin" : h.status === "done" ? "check" : "x"} small className={working && !waiting && !stalled ? "spin-st" : undefined} />
        </span>
        <span className="grow">
          <b>{h.name}</b>
          {facts?.line ? <small>{facts.line}</small> : null}
        </span>
        <span className="hp-right-pn">
          <span className={`pill ${waiting ? "you" : working ? "work" : "idle"}`}>
            <i />
            {pill}
          </span>
          {working || waiting ? (
            <button type="button" className="btn ghost sm" aria-label={`Stop ${h.name}`} onClick={onStop}>
              Stop
            </button>
          ) : null}
        </span>
      </div>
      {h.task || facts?.job ? <p className="hp-job-pn">Job: {h.task || facts?.job}</p> : null}
      {facts?.thinking ? <details className="hp-think-pn"><summary>What it's thinking</summary><p>{facts.thinking}</p></details> : null}
      {h.error ? <p className="err-st">{shortReason(h.error)}</p> : null}
      {asks.map((a) => (
        <div key={a.id} className="hp-ask-pn">
          <span className="grow">
            <b>{a.command}</b>
            <small>asked by {h.name}</small>
          </span>
          <span className="hp-btn-pn">
            <button type="button" className="btn ghost sm" onClick={() => onAnswer(a.id, "deny")}>
              No
            </button>
            <button type="button" className="btn pri sm" onClick={() => onAnswer(a.id, "allow-once")}>
              Allow once
            </button>
          </span>
        </div>
      ))}
      {facts?.cost !== undefined ? <small className="hp-m-pn">{money(facts.cost)}</small> : null}
    </div>
  );
}

/** Activity: what it's doing now, the Canopy card it works on, its recent steps and its helpers. */
export function ActivityTab({ engine, name, blocks, running, focusHelpers = 0, onError }: { engine: WindowEngine; name: string; blocks: Block[]; running: boolean; level: Level; focusHelpers?: number; onError: (m: string) => void }) {
  const helperSection = useRef<HTMLElement>(null);
  const { helpers } = useHelpers(engine);
  useEffect(() => { if (focusHelpers && helpers.length) helperSection.current?.scrollIntoView?.({ block: "start" }); }, [focusHelpers, helpers.length]);
  const { details } = useApprovalDetails(engine);
  const card = useCanopyCard(engine);
  const facts = useHelperFacts(engine, helpers);
  const approvals = [...details.values()];
  const mine = approvals.filter((a) => !a.decision && a.sessionKey === engine.sessionKey).length;
  const helperWaiting = approvals.filter((a) => !a.decision && helpers.some((h) => h.key === a.sessionKey)).length;
  const state = activityState(running, mine + helperWaiting);
  const asOf = activityRecordedAt(blocks);
  const steps = blocks.filter((b): b is Extract<Block, { kind: "step" }> => b.kind === "step");
  const shown = steps.slice(-8);
  const first = steps.length - shown.length;
  const direct = helpers.filter((h) => h.parent === engine.sessionKey);
  return (
    <>
      <p className="hg-pn">
        <i className={`dot-pn ${state.tone}`} />
        {state.text}{asOf === undefined ? "" : ` · as of ${new Date(asOf).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
      </p>
      {card ? (
        <div className="prow-pn">
          <span className="tile-st">
            <SIcon name="layout" small />
          </span>
          <span className="grow">
            <b>In Canopy: {card.title}</b>
          </span>
          <span className="pill idle">{CARD_STATE[card.status] ?? card.status}</span>
        </div>
      ) : null}
      {shown.length ? (
        <ol className="tl-pn">
          {shown.map((b, i) => (
            <li key={b.key} className={b.status}>
              <SIcon name={b.status === "ok" ? "check" : b.status === "running" ? "spin" : b.status === "denied" || b.status === "failed" ? "x" : "info"} small className={b.status === "running" ? "spin-st" : undefined} />
              <span>
                {stepLabel(b)}
                {b.detail && !/^\s*[\[{]/.test(b.detail) ? <small>{shortReason(b.detail)}</small> : null}
              </span>
              <time>{b.at ? new Date(b.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : `Step ${first + i + 1}`}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pane-empty">No steps yet. What {name} does shows here as it works.</p>
      )}
      {helpers.length ? (
        <section ref={helperSection} className="hp-pn" aria-label="Helpers on this task">
          <div className="hph-pn">
            <h3>Helpers on this task</h3>
            <small>
              {direct.length} started by {name}
              {helperWaiting ? ` · ${needsYou(helperWaiting)}` : ""}
            </small>
          </div>
          <div className="hp-root-pn">
            <Face size={22} label={name} state={running ? "work" : "idle"} />
            <b>{name}</b>
          </div>
          <div className="hp-kids-pn" role="list">
            {helpers.map((h) => (
              <HelperCard
                key={h.key}
                h={h}
                facts={facts.get(h.key)}
                asks={approvals.filter((a) => a.sessionKey === h.key && !a.decision)}
                onStop={() => void engine.request("sessions.abort", { key: h.key }).catch((e: unknown) => onError(errorText(e)))}
                onAnswer={(id, d) => void resolveApproval(engine, id, d, details.get(id)?.plugin ?? false).catch((e: unknown) => onError(errorText(e)))}
              />
            ))}
          </div>
          <p className="hint-st">Each helper runs on its own model and asks for its own approvals. Nothing a helper does skips your rules.</p>
        </section>
      ) : null}
    </>
  );
}
