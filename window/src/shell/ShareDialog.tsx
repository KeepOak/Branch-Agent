// Share… (DESIGN-SPEC §4.2.7): who else on this Branch may see the conversation, who is in it, and its public
// link. Reads session.members.list and writes session.visibility.set, session.members.add/remove and
// session.publicShare.set, as OpenClaw's chat pane does (ui/src/pages/chat/chat-pane-sharing-actions.ts).
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "./Dialog";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Visibility = "shared" | "read-only" | "suggest" | "draft";
type Identity = { id: string; name: string };
type Sharing = { visibility: Visibility | null; allowed: Visibility[]; owner: Identity | null; members: Set<string>; people: Identity[]; publicToken: string | null; canChange: boolean };

/** The words for each level, for everyone else on this Branch (draft is its own switch). */
export const VISIBILITY_WORDS: [Visibility, string][] = [["read-only", "May read it"], ["suggest", "May suggest"], ["shared", "May write in it"]];

const identity = (v: unknown): Identity => ({ id: str(rec(v).id), name: str(rec(v).displayName) || str(rec(v).name) || str(rec(v).label) || str(rec(v).id) });

export function readSharing(raw: unknown, visibility: unknown): Sharing {
  const r = rec(raw);
  const allowed = (Array.isArray(r.allowedVisibilities) ? r.allowedVisibilities : []).filter((v): v is Visibility => ["shared", "read-only", "suggest", "draft"].includes(String(v)));
  const owner = r.owner ? identity(r.owner) : null;
  return {
    visibility: ["shared", "read-only", "suggest", "draft"].includes(String(visibility)) ? (visibility as Visibility) : null,
    allowed,
    owner,
    members: new Set((Array.isArray(r.members) ? r.members : []).map((m) => str(rec(m).identityId))),
    people: (Array.isArray(r.identities) ? r.identities : []).map(identity).filter((p) => p.id && p.id !== owner?.id),
    publicToken: str(rec(r.publicShare).token) || null,
    canChange: r.role === "owner" || r.role === "admin",
  };
}

type Props = { engine: WindowEngine; sessionKey: string; agentId?: string; sessionId?: string; title: string; publicLink: (token: string) => string; onCopy: (text: string) => void; onClose: () => void };

function useSharing(engine: WindowEngine, sessionKey: string, agentId?: string) {
  const [state, setState] = useState<Sharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const target = { sessionKey, ...(agentId ? { agentId } : {}) };
    const [list, row] = await Promise.all([
      engine.request("session.members.list", target),
      engine.request("sessions.describe", { key: sessionKey, ...(agentId ? { agentId } : {}) }),
    ]);
    setState(readSharing(list, rec(rec(row).session).visibility));
  }, [engine, sessionKey, agentId]);
  useEffect(() => {
    load().catch((e: unknown) => setError(reason(e)));
  }, [load]);
  const change = (method: string, params: Record<string, unknown>) => {
    setError(null);
    engine.request(method, { sessionKey, ...(agentId ? { agentId } : {}), ...params }).then(load).catch((e: unknown) => setError(reason(e)));
  };
  return { state, error, change };
}

export function ShareDialog({ engine, sessionKey, agentId, sessionId, title, publicLink, onCopy, onClose }: Props) {
  const { state, error, change } = useSharing(engine, sessionKey, agentId);
  const can = state?.canChange ?? false;
  const draft = state?.visibility === "draft";
  return (
    <Dialog title={`Share ${title}`} wide onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>} testid="share-dialog">
      {state ? (
        <div className="share-b">
          <div className="share-row">
            <b>Everyone else on this Branch</b>
            <div className="seg" role="radiogroup" aria-label="Everyone else on this Branch">
              {VISIBILITY_WORDS.filter(([v]) => state.allowed.includes(v)).map(([v, words]) => (
                <button key={v} type="button" role="radio" aria-checked={state.visibility === v} className={state.visibility === v ? "on" : ""} disabled={!can}
                  onClick={() => change("session.visibility.set", { visibility: v })}>{words}</button>
              ))}
            </div>
            <small className="hint">The people below can still be added one by one.</small>
          </div>
          {state.allowed.includes("draft") ? (
            <div className="share-row share-sw">
              <span><b>Keep it a draft</b><small className="hint">Only you and the owner see it until you publish.</small></span>
              <Toggle label="Keep it a draft" on={draft} disabled={!can} onChange={(on) => change("session.visibility.set", { visibility: on ? "draft" : "shared" })} />
            </div>
          ) : null}
          {state.owner ? <div className="share-row"><small className="hint">Owner</small><b>{state.owner.name}</b></div> : null}
          <People state={state} can={can} change={change} />
          <PublicLink token={state.publicToken} can={can && Boolean(sessionId)} link={publicLink} onCopy={onCopy}
            onSet={(enabled) => change("session.publicShare.set", { expectedSessionId: sessionId, enabled })} />
          <p className="hint">They see who started it, who owns it, and who else is in it. Their drafts stay private until they send.</p>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}

function People({ state, can, change }: { state: Sharing; can: boolean; change: (m: string, p: Record<string, unknown>) => void }) {
  if (!state.people.length) return <p className="hint">No one else is paired with this Branch yet.</p>;
  return (
    <ul className="share-people">
      {state.people.map((p) => {
        const member = state.members.has(p.id);
        return (
          <li key={p.id}>
            <span className="share-av" aria-hidden="true">{p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
            <b>{p.name}</b>
            <span className="share-sw">
              <small>{member ? "In it" : "No"}</small>
              <Toggle label={`${p.name} is in this conversation`} on={member} disabled={!can}
                onChange={(on) => change(on ? "session.members.add" : "session.members.remove", { identityId: p.id })} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PublicLink({ token, can, link, onCopy, onSet }: { token: string | null; can: boolean; link: (t: string) => string; onCopy: (text: string) => void; onSet: (enabled: boolean) => void }) {
  return (
    <div className="share-row">
      <b>Public link</b>
      <small className="hint">{token ? "Anyone with the link can read the conversation's text without signing in. Tools, thinking, files and widgets are left out." : "Only people with access can see it."}</small>
      <div className="card-buttons">
        {token ? <button type="button" className="btn sm" onClick={() => onCopy(link(token))}>Copy public link</button> : null}
        <button type="button" className="btn sm ghost" disabled={!can} onClick={() => onSet(!token)}>{token ? "Turn off the public link" : "Make a public link…"}</button>
      </div>
    </div>
  );
}

function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={disabled} onClick={() => onChange(!on)} />;
}
