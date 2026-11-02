// The grouped card (preview ask2, HANDOFF R1-05): two or more approvals that wait in one conversation show together as
// "Two things need you", each row with its command and Yes / No, and "Yes to both" when more than one still waits.
// Answered rows keep their pill ("Allowed" / "Refused") until the conversation is left, as the preview's card does.
import { useState } from "react";
import { Coming } from "../../glass/coming";
import { LOCKDOWN_WHY } from "./AskCard";
import { RESOLVE_OF, settledText, type Reply } from "./model";
import type { AskState } from "./useAsks";
import "../../glass/glass.css";
import "./approvals.css";

const COUNT = ["", "", "Two", "Three", "Four", "Five", "Six"] as const;
const RESOLVE_WHY = "Answering here comes in a later update. Answer in the conversation’s chat app or the terminal.";

/** Only an approval that offers "Allow once" can be answered Yes here; questions keep their own card. */
export const groupable = (state: AskState) => state.ask.kind !== "question" && state.ask.allowed.includes("allow-once");

/** The group's members for one conversation: two or more waiting approvals form it, and it keeps them (answered rows
 *  included) until the conversation changes. Derived during render, so no effect and no extra render pass. */
export function useAskGroup(scope: string | null, waiting: readonly AskState[]): string[] {
  const [group, setGroup] = useState<{ scope: string | null; ids: string[] }>({ scope, ids: [] });
  const current = group.scope === scope ? group.ids : [];
  const fresh = waiting.filter(groupable).map((s) => s.ask.id);
  const next = fresh.length >= 2 ? [...new Set([...current, ...fresh])] : current;
  if (group.scope !== scope || next.join("\n") !== group.ids.join("\n")) setGroup({ scope, ids: next });
  return next;
}

/** What a settled row says, in the preview's words. */
function doneWord(state: AskState, name: string): string {
  const how = state.settled;
  if (how === "allow-once" || how === "allow-always") return "Allowed";
  if (how === "deny") return "Refused";
  return settledText(state.ask, how ?? "elsewhere", name).text;
}

function GroupRow({ state, name, lockdown, onAnswer }: { state: AskState; name: string; lockdown?: boolean; onAnswer: (id: string, reply: Reply) => void }) {
  const { ask } = state;
  const busy = state.status === "sending";
  const off = busy || lockdown;
  return (
    <div className="r1-ask-grow" data-testid="r1-ask-group-row" data-approval={ask.id}>
      <span><b>{name}: {ask.title.replace(/\?$/, "")}</b>{ask.code ? <code>{ask.code}</code> : null}</span>
      {state.status === "settled" ? <span className="r1-ask-pill" data-tone={state.settled === "deny" ? "bad" : "ok"}>{doneWord(state, name)}</span> : (
        <span className="r1-ask-acts">
          <Coming need={RESOLVE_OF[ask.kind]} reason={RESOLVE_WHY}>
            <button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" disabled={off} title={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAnswer(ask.id, "allow-once")}>Yes</button>
          </Coming>
          <Coming need={RESOLVE_OF[ask.kind]} reason={RESOLVE_WHY}>
            <button type="button" className="r1-ask-btn" data-kind="ghost" disabled={busy} onClick={() => onAnswer(ask.id, "deny")}>No</button>
          </Coming>
        </span>
      )}
      {state.error ? <p className="r1-ask-error" role="alert">That didn’t go through: {state.error} Try again.</p> : null}
    </div>
  );
}

/** The group card: the header pill says whether anything still waits, then one row per member. */
export function AskGroup({ members, name, lockdown, onAnswer }: { members: readonly AskState[]; name: string; lockdown?: boolean; onAnswer: (id: string, reply: Reply) => void }) {
  const pending = members.filter((s) => s.status !== "settled" && groupable(s));
  const label = COUNT[members.length] ?? String(members.length);
  return (
    <div className="r1-ask r1-ask-group g-clear" data-testid="r1-ask-group">
      <div className="r1-ask-head">
        <span className="r1-ask-q">{label} things need you</span>
        <span className="r1-ask-pill" data-tone={pending.length ? "wait" : "ok"}><i />{pending.length ? "Waiting for you" : "Answered"}</span>
      </div>
      {members.map((state) => <GroupRow key={state.ask.id} state={state} name={name} lockdown={lockdown} onAnswer={onAnswer} />)}
      {pending.length > 1 ? (
        <div className="r1-ask-acts">
          <Coming need={RESOLVE_OF.exec} reason={RESOLVE_WHY}>
            <button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" disabled={lockdown} title={lockdown ? LOCKDOWN_WHY : undefined}
              onClick={() => pending.forEach((s) => onAnswer(s.ask.id, "allow-once"))}>Yes to both</button>
          </Coming>
        </div>
      ) : null}
    </div>
  );
}
