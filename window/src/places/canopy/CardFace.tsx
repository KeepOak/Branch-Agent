// A Canopy card on the board (§4.6.7 card face): title, conversation state, block pill, priority, labels,
// badges and its Trunk; its ⋯ menu moves, edits, starts, stops, archives and deletes it.
import { useState, type DragEvent } from "react";
import { shows } from "../../places-nav/level";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { rec, str, type Row } from "../automations/runtime";
import { BLOCK, isArchived, trunkName, waitsFor, whyOf } from "./data";
import { badges, convState, prioName, STATUSES } from "./cards-model";
import { anchorOf, Nobody, Pill, TrunkFace, type Ctx } from "./ui";

export type CardOps = {
  move: (c: Row, status: string) => void; edit: (c: Row) => void; sheet: (c: Row) => void; start: (c: Row, provider?: string) => void;
  byHand: (c: Row) => void; stop: (c: Row) => void; archive: (c: Row) => void; remove: (c: Row) => void;
  selected: string[]; select: (id: string, on: boolean) => void; density: "comfortable" | "compact";
};

export function cardMenu(ctx: Ctx, c: Row, ops: CardOps): MenuItem[] {
  const agent = str(c.agentId) || ctx.d.defaultTrunk, running = !!str(c.sessionKey) && c.status === "running";
  const off = ctx.write ? undefined : "Needs permission to change cards.";
  const startable = ["backlog", "todo", "ready"].includes(str(c.status)) ? off : "Move it to Backlog, To do or Ready first.";
  return [
    { kind: "head", label: "Move to" },
    ...STATUSES.map(([k, l]): MenuItem => ({ label: l, hint: c.status === k ? "✓" : undefined, disabled: off, run: () => ops.move(c, k) })),
    { kind: "sep" },
    { label: "Edit card", disabled: off, run: () => ops.edit(c) }, { label: "Details", run: () => ops.sheet(c) },
    ...(running ? [
      { label: "Open conversation", run: () => ctx.openConversation(str(c.sessionKey)) },
      { label: "Stop", danger: true, disabled: off, run: () => ops.stop(c) },
    ] : [
      { label: "Start", hint: trunkName(ctx.d, agent), disabled: startable, run: () => ops.start(c) },
      { kind: "head", label: "Other ways to start" } as MenuItem,
      { label: "Run with Claude", disabled: startable, run: () => ops.start(c, "anthropic") },
      { label: "Run with OpenAI", disabled: startable, run: () => ops.start(c, "openai") },
      { label: "Open with Claude", disabled: "Needs the engine's method to open a linked conversation on a connection's model.", run: () => undefined },
      { label: "Open with OpenAI", disabled: "Needs the engine's method to open a linked conversation on a connection's model.", run: () => undefined },
      { label: "Open a conversation by hand", disabled: off, run: () => ops.byHand(c) },
    ]),
    { kind: "sep" },
    { label: isArchived(c) ? "Restore" : "Archive", disabled: off, run: () => ops.archive(c) },
    { label: "Delete…", danger: true, disabled: off, run: () => ops.remove(c) },
  ];
}

export function CardFace({ ctx, c, ops }: { ctx: Ctx; c: Row; ops: CardOps }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const id = str(c.id), adv = shows(ctx.level, "advanced"), [state, tip] = convState(c, ctx.d.sessions, ctx.now);
  const agent = str(c.agentId), labels = Array.isArray(c.labels) ? c.labels.map(String) : [];
  const waits = waitsFor(c).filter(w => ctx.d.cards.find(x => str(x.id) === w)?.status !== "done");
  const why = c.status === "blocked" ? whyOf(c, ctx.d.cards) : null, sel = ops.selected.includes(id);
  const drag = (e: DragEvent) => { e.dataTransfer.setData("text/canopy-card", id); e.dataTransfer.effectAllowed = "move"; };
  const scheduled = Number(rec(rec(c.metadata).automation).scheduledAt);
  return (
    <div className={sel ? "cn-card sel" : "cn-card"} role="listitem" tabIndex={0} draggable={ctx.write} onDragStart={drag} aria-label={str(c.title)}
      onClick={e => { if (!(e.target as Element).closest("button, input, label")) ops.sheet(c); }} onKeyDown={e => { if (e.key === "Enter" && e.target === e.currentTarget) ops.sheet(c); }}>
      {adv ? <input type="checkbox" className="cn-tick-box" checked={sel} aria-label={`Select “${str(c.title)}”`} onChange={e => ops.select(id, e.target.checked)} /> : null}
      <b>{str(c.title)}</b>
      <small className="cn-cstate" title={tip || undefined}>{state}</small>
      {why ? <Pill tone={BLOCK[why.why][0]} tip={why.detail || undefined}>{BLOCK[why.why][1]}</Pill> : null}
      {isArchived(c) ? <Pill tone="idle">Archived</Pill> : null}
      {str(c.priority) && c.priority !== "normal" ? <small className="cn-prio">{prioName(c.priority)}</small> : null}
      {labels.length ? <span className="cn-labels">{labels.slice(0, 2).map(l => <i key={l}>{l}</i>)}</span> : null}
      {waits.length && adv ? <small className="cn-note">Waits for {waits.length} {waits.length === 1 ? "card" : "cards"}</small> : null}
      {ops.density === "compact" ? null : <span className="cn-badges">{badges(c, ctx.d.cards).map(b => <span key={b}>{b}</span>)}</span>}
      <span className="cn-foot">{agent ? <TrunkFace name={trunkName(ctx.d, agent)} size={18} /> : <Nobody />}<small>{scheduled > 0 ? new Date(scheduled).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : agent ? trunkName(ctx.d, agent) : "No Trunk yet"}</small></span>
      <button type="button" className="cn-mv" aria-label={`More for “${str(c.title)}”`} aria-haspopup="menu" aria-expanded={!!menu} onClick={e => setMenu(menu ? null : anchorOf(e.currentTarget))}><Icon name="more" /></button>
      {menu ? <Menu at={menu} label={`More for “${str(c.title)}”`} items={cardMenu(ctx, c, ops)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
