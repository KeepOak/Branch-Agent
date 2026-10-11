// Read the scheduler's own records. Queue jobs are not editable Canopy cards:
// copying them into that store would create a second owner for claims and completion.
import { str } from "../automations/runtime";
import { trunkName } from "./data";
import type { Ctx } from "./ui";

const labels: Record<string, string> = { queued: "Queued", released: "Waiting for another Trunk", claimed: "Working", needs_attention: "Needs attention", blocked: "Blocked", done: "Done" };
export function QueueWork({ ctx, refresh }: { ctx: Ctx; refresh: () => void }) {
  return <section className="cn-queue" aria-label="Trunk queue">
    <h2>Trunk queue</h2>
    <p className="cn-hint">Jobs waiting for a Trunk, being worked on, or finished on this connection. Trunks update these automatically.</p>
    <button type="button" className="btn sm" onClick={refresh}>Refresh work</button>
    {ctx.d.queueError ? <p role="alert" className="cn-err">The Trunk queue couldn’t be loaded. Try refreshing.</p>
      : !ctx.d.queue?.length ? <p className="cn-hint">No queued jobs.</p>
      : <ul className="cn-rows">{ctx.d.queue.map(job => <li className="cn-prow" key={str(job.id)}>
        <span className="cn-grow"><b>{str(job.title)}</b><small>{labels[str(job.status)] || "Status unavailable"}{job.claimed_by ? ` · ${trunkName(ctx.d, str(job.claimed_by))}` : ""}</small>
          {job.attention_reason || job.blocked_reason ? <small>{str(job.attention_reason) || str(job.blocked_reason)}</small> : null}
          <details><summary>Job brief</summary><p className="cn-hint">{str(job.brief_text)}</p></details>
        </span>
        {job.thread_key ? <button type="button" className="btn sm" onClick={() => ctx.openConversation(str(job.thread_key))}>Open conversation</button> : null}
      </li>)}</ul>}
  </section>;
}
