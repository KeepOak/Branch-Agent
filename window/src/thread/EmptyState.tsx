// A new conversation (DESIGN-SPEC §4.2.9). The empty state shows only this Trunk's own face, as its still. With no
// model, the line "Please connect a model, or click here to set up a local model." is the composer's (NoModelLine),
// so it shows once, on every conversation, not twice on an empty one.
import { useEffect, useState } from "react";
import { currentModelRef } from "../composer/model";
import { hasNoModel, useConversation } from "../composer/useConversation";
import { Face } from "../face/Face";
import { useThread } from "./context";
import { messageTime } from "./format";
import "./empty.css";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

type Row = { key: string; title: string; at: number };

/** Up to five recent conversations with this Trunk (§4.2.9 Parity adds "Recent with this Trunk"). */
function useRecent(open: boolean): Row[] {
  const { engine } = useThread();
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (!open || !engine?.agentId) return;
    engine.request("sessions.list", { agentId: engine.agentId, limit: 6, includeDerivedTitles: true }).then(
      (r) => {
        const list = Array.isArray(rec(r).sessions) ? (rec(r).sessions as unknown[]).map(rec) : [];
        setRows(list.filter((s) => str(s.key) !== engine.sessionKey).slice(0, 5)
          .map((s) => ({ key: str(s.key), title: str(s.label) || str(s.derivedTitle) || str(s.displayName) || str(s.key), at: Number(s.updatedAt) || 0 })));
      },
      () => setRows([]),
    );
  }, [engine, open]);
  return rows;
}

/** Four things to ask, by what the Trunk is for (its identity theme); the default Trunk gets the last list (§4.2.9). */
const STARTERS: [RegExp, string[]][] = [
  [/research/i, ["Research a topic and write a one-page brief", "Compare three options and say which is best", "Check a claim and show me the sources", "Keep an eye on news about a subject"]],
  [/money|receipt|expense/i, ["Match this month’s receipts to my card statement", "Build my expense report for this month", "Tell me what I spend on subscriptions", "Find any charge I don’t recognise"]],
  [/trip|travel/i, ["Plan a weekend away next month", "Find a refundable flight for my next trip", "Make an itinerary for a trip I booked", "Find a quiet place to stay near the centre"]],
  [/read|note/i, ["Summarise a document I point you to", "Turn my notes into a to-do list", "Pull the key dates out of a document", "Write up notes from a voice memo"]],
  [/subscri|renew/i, ["List my subscriptions and what they cost", "Tell me before anything renews", "Find a subscription I no longer use", "Compare my plan with a cheaper one"]],
];
const EVERYDAY = ["Tidy my Downloads folder", "Find a file I worked on last week", "Free up space on this computer", "Plan my week from my calendar"];

export function startersFor(theme: string, isDefault: boolean): string[] {
  if (isDefault || !theme) return EVERYDAY;
  return STARTERS.find(([re]) => re.test(theme))?.[1] ?? EVERYDAY;
}

/** The four starters, once a model is set up; with none, the composer's no-model line says what to do instead. */
function Starters({ onStart }: { onStart: (text: string) => void }) {
  const { engine } = useThread();
  const conv = useConversation(engine);
  if (!conv.loaded || hasNoModel(conv, currentModelRef(conv.row, conv.defaults))) return null;
  const trunk = conv.trunk;
  const list = startersFor(trunk?.theme ?? "", !trunk || trunk.id === conv.defaultTrunkId);
  return (
    <>
      <p className="empty-where">Pick where it works, then say what to do.</p>
      <div className="starters">
        {list.map((s) => (
          <button key={s} type="button" className="chipb" onClick={() => onStart(s)}>{s}</button>
        ))}
      </div>
    </>
  );
}

export function EmptyState({ onOpenSession, onStart }: { onOpenSession?: (key: string) => void; onStart?: (text: string) => void }) {
  const { name } = useThread();
  const recent = useRecent(Boolean(onOpenSession));
  return (
    <div className="empty" data-testid="empty-state">
      <Face size={150} label={name} state="idle" reactive />
      <h1 className="empty-title">What should {name} do?</h1>
      {onStart ? <Starters onStart={onStart} /> : null}
      {onOpenSession && recent.length ? (
        <div className="recent">
          <div className="section-label">Recent</div>
          {recent.map((r) => (
            <button key={r.key} type="button" className="recent-row" onClick={() => onOpenSession(r.key)}>
              <span>{r.title}</span>
              <time>{r.at ? messageTime(r.at) : ""}</time>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
