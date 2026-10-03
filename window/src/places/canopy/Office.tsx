// Canopy's "Office view" (§4.6.7, preview 96-appopsp): each Trunk at its desk, facing its screen while it works,
// turned to you when it needs you. States come from the live conversations and the approval queues.
import { Dialog } from "../../shell/Dialog";
import { rec, str } from "../automations/runtime";
import { isHelper, isRunning } from "./data";
import { TrunkFace, type Ctx } from "./ui";

type DeskState = "working" | "waiting" | "idle";
const WORDS: Record<DeskState, string> = { working: "Working", waiting: "Needs you", idle: "Idle" };

export function deskState(ctx: Pick<Ctx, "d">, agentId: string): DeskState {
  const mine = ctx.d.sessions.filter(s => str(s.agentId) === agentId && !isHelper(s));
  const asks = (key: string, id: string) => id === agentId || mine.some(s => str(s.key) === key);
  if (ctx.d.pending.some(p => asks(str(rec(p.request).sessionKey), str(rec(p.request).agentId)))) return "waiting";
  return mine.some(isRunning) ? "working" : "idle";
}

export function OfficeDialog({ ctx, close }: { ctx: Ctx; close: () => void }) {
  const open = (id: string) => { close(); ctx.openConversation(`agent:${id}:${ctx.d.mainKey}`); };
  return (
    <Dialog title="The office" wide onClose={close} footer={null}>
      <p className="cn-hint cn-flush">Each Trunk at its desk: facing its screen while it works, turned to you when it needs you.</p>
      <div className="cn-office">
        {ctx.d.trunks.map(t => {
          const st = deskState(ctx, t.id);
          return <button key={t.id} type="button" className={`cn-desk st-${st}`} onClick={() => open(t.id)}>
            <span className="cn-screen" aria-hidden="true">{st === "working" ? "▤" : ""}</span>
            <TrunkFace name={t.name} size={30} working={st === "working"} />
            <b>{t.name}</b><small>{WORDS[st]}</small>
          </button>;
        })}
      </div>
      {!ctx.d.trunks.length ? <p className="cn-hint cn-flush">No Trunks yet.</p> : null}
    </Dialog>
  );
}
