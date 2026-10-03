// Notifications › the rows the engine has no key for yet: events to a web address, stalled work, live activity,
// kinds of notice and sorting rules. Each is drawn greyed with its reason (unchecked: nothing does it today).
import { Btn, Ctl, Hint, Sec, Switch, useLevel } from "../kit";

export const KINDS = ["Health", "Urgent", "Reminders", "Email", "Calendar", "Builds", "Stocks", "Everything else"];
export const HOOK_EVENTS = ["A conversation finished", "An automation ran", "An automation failed", "Something needs you"];
const HOOK_OFF = "Branch can’t send its events to a web address yet; each automation can post to one of its own.";
const KIND_OFF = "Branch doesn’t sort notices into kinds yet.";
const RULE_OFF = "Branch doesn’t sort notices by your own rules yet.";

const isMac = () => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

export function WebAddress() {
  return (
    <Sec title="Send events to a web address">
      <Ctl title="Address" sub="Discord, Slack or any webhook." off={HOOK_OFF}>
        <input className="inp nt-hook" aria-label="Address" placeholder="https://hooks.example/…" disabled />
      </Ctl>
      <Ctl title="Events" sub="" off={HOOK_OFF} stack>
        <span className="nt-chips">
          {HOOK_EVENTS.map((e) => <button key={e} type="button" className="chip6" aria-pressed={false} disabled>{e}</button>)}
        </span>
      </Ctl>
    </Sec>
  );
}

export function WorkStalls() {
  return (
    <Sec title="When work stalls">
      <Ctl title="A conversation stopped moving" sub="Once, when a Trunk has something to do but has made no progress for a while." off="Branch doesn’t watch for stalled conversations yet.">
        <Switch checked={false} disabled label="A conversation stopped moving" onChange={() => undefined} />
      </Ctl>
    </Sec>
  );
}

export function LiveActivity() {
  const title = isMac() ? "Live activity at the top of the screen" : "Live activity at the top of the screen (Mac)";
  return (
    <Sec title="Live activity">
      <Ctl title={title} sub="A small pill under the menu bar shows each working Trunk’s current step; it opens when one needs you." off="Only in the Branch app on a Mac.">
        <Switch checked={false} disabled label={title} onChange={() => undefined} />
      </Ctl>
    </Sec>
  );
}

export function KindsOfNotice() {
  return (
    <Sec title="Kinds of notice" hint="A notice a Trunk sends you is sorted into one of these. Turning a kind off stops its pop-ups; it still shows in Recent notifications.">
      <Hint>{KIND_OFF}</Hint>
      {KINDS.map((k) => (
        <Ctl key={k} title={k} sub="" keep="everywhere" off={KIND_OFF}>
          <Switch checked={false} disabled label={k} onChange={() => undefined} />
        </Ctl>
      ))}
    </Sec>
  );
}

export function SortingRules() {
  const level = useLevel();
  if (level < 2) return null;
  return (
    <Sec title="Sorting notifications">
      <Ctl title="Use the kind a Trunk gives" sub="When a Trunk marks a notice urgent, a reminder and so on, that wins over your rules." off={RULE_OFF}>
        <Switch checked={false} disabled label="Use the kind a Trunk gives" onChange={() => undefined} />
      </Ctl>
      <p className="hint nt-tight">No rules yet.</p>
      <Ctl title="Add a rule" sub="" off={RULE_OFF}>
        <span className="nt-rule">
          <input className="inp" aria-label="Words or pattern" placeholder="Words or pattern" disabled />
          <label className="chk nt-chk"><input type="checkbox" disabled /> Treat as a pattern</label>
          <select className="inp" aria-label="Kind" disabled>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <Btn sm disabled>Add</Btn>
        </span>
      </Ctl>
    </Sec>
  );
}
