import type { NativeHelper } from "./native-helpers";

const STATUS = { running: "Working at last update", done: "Done", interrupted: "Interrupted", unknown: "Status not reported" };

/** Parent-recorded facts, not fabricated child sessions or controls. */
export function NativeHelpers({ helpers }: { helpers: readonly NativeHelper[] }) {
  return <div className="hp-kids-pn" role="list" aria-label="Native subagents">
    {helpers.map((helper) => <div key={helper.key} className="hp-card-pn" role="listitem">
      <div className="hp-top-pn"><b className="grow">{helper.name}</b><span className="pill idle">{STATUS[helper.status]}</span></div>
      {helper.at ? <small>Last update: {new Date(helper.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small> : null}
      {helper.task ? <details className="hp-think-pn"><summary>Assigned task</summary><p style={{ whiteSpace: "pre-wrap" }}>{helper.task}</p></details> : null}
    </div>)}
    <p className="hint-st">These subagents run inside this conversation, not as sidebar chats. This shows their recorded assignments and last reported status. Ask here to steer or stop one.</p>
  </div>;
}
