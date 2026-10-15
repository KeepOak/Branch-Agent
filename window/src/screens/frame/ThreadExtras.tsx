// Two Classic thread pieces the R1 window lacked, re-hosted over its composer: the done cheer (thread/DoneCheer.tsx), the
// Trunk's face in its "yay" state when its work ends, and "Where it works" (thread/WhereChips.tsx), the computer and folder
// chips on an empty conversation. Neither is placed by the approved design; both sit where Classic had them, just above
// the composer. A folder or copy picked there starts a new conversation in it through sessions.create, the call WhereChips
// names, and opens it.
import type { Conversation } from "../../connect/conversations";
import type { RunEnd, SaplingSession } from "../../connect/session";
import { shows, useLevel } from "../../places-nav/level";
import { notify } from "../../shell/notify";
import { DoneCheer } from "../../thread/DoneCheer";
import type { Block } from "../../thread/model";
import { WhereChips } from "../../thread/WhereChips";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export type ThreadExtrasProps = {
  session: SaplingSession;
  ready: boolean;
  name: string;
  row: Conversation | null;
  history: readonly Block[];
  ended?: RunEnd | null;
  /** Nothing is said or running yet: the chips show. */
  empty: boolean;
  onOpen: (key: string) => void;
};

/** Starts a conversation for this Trunk where the chips say (sessions.create with projectId, cwd, projectGitUrl or worktree). */
export async function startWhere(session: Pick<SaplingSession, "request">, agentId: string | undefined, params: Record<string, unknown>): Promise<string | null> {
  const result = rec(await session.request("sessions.create", { ...(agentId ? { agentId } : {}), ...params }));
  return str(result.key) || str(result.sessionKey) || null;
}

export function ThreadExtras(p: ThreadExtrasProps) {
  const advanced = shows(useLevel(), "advanced");
  return <div className="r1-thread-extras">
    <div className="r1-cheer"><DoneCheer name={p.name} ended={p.ended} history={p.history} room={Boolean(p.row?.groupChat)} /></div>
    {p.ready && p.empty ? <div className="r1-where g-clear"><WhereChips key={p.row?.key ?? "none"} engine={p.session.engine} row={p.row} trunkName={p.name} advanced={advanced} projectName={null}
      onStartTopic={(params) => {
        void startWhere(p.session, p.row?.agentId, params).then(
          (key) => { if (key) p.onOpen(key); else notify("The engine didn't return the new conversation.", { tone: "bad" }); },
          (error: unknown) => notify(`Couldn't start it there: ${error instanceof Error ? error.message : String(error)}`, { tone: "bad" }),
        );
      }} /></div> : null}
  </div>;
}
