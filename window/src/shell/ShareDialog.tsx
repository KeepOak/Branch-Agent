// Share… (DESIGN-SPEC §4.2.7): who else on this Branch may see the conversation, who is in it, and its public
// link. Reads session.members.list and writes session.visibility.set, session.members.add/remove and
// session.publicShare.set, as OpenClaw's chat pane does (ui/src/pages/chat/chat-pane-sharing-actions.ts).
// Paired computers read the conversation through the session-share plugin: the same visibility call publishes a
// draft, sessions.patch puts it in a group, and plugins.entries.session-share names that group. People › Shared
// still lists and manages members; this dialog only starts the paired reading.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Coming } from "../glass/coming";
import { configStore } from "../places/settings/config-store";
import { Dialog } from "./Dialog";
import { publishedVisibility } from "../connect/safe-visibility";
import {
  PAIRED_SHARE_ENABLED_PATH,
  PAIRED_SHARE_GROUPS_PATH,
  PAIRED_SHARE_NEED,
  pairedShareBlock,
  pairedShareGroup,
  pairedShareHint,
  pairedShareEnabled,
  pairedSharePublished,
  pairedShareWrites,
  readPairedSession,
  shareGroupsOf,
  type PairedSession,
} from "./paired-share";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Visibility = "shared" | "read-only" | "suggest" | "draft";
type Identity = { id: string; name: string };
type Sharing = { visibility: Visibility | null; allowed: Visibility[]; owner: Identity | null; members: Set<string>; people: Identity[]; publicToken: string | null; canChange: boolean };

/** The words for each level, for everyone else on this Branch (draft is its own switch). */
const VISIBILITY_WORDS: [Visibility, string][] = [["read-only", "May read it"], ["suggest", "May suggest"], ["shared", "May write in it"]];

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

/** clear: README item 48 glass (the R1 conversation menu): a clear dialog whose words sit on frosted pills. */
type Props = { engine: WindowEngine; sessionKey: string; agentId?: string; sessionId?: string; title: string; publicLink: (token: string) => string; onCopy: (text: string) => void; onClose: () => void; clear?: boolean };

/** On clear glass a run of words gets its own frosted pill (glass.css .g-label). */
const onPill = (clear?: boolean) => (base?: string) => (clear ? [base, "g-label"].filter(Boolean).join(" ") : base);

function useSharing(engine: WindowEngine, sessionKey: string, agentId?: string) {
  const [state, setState] = useState<Sharing | null>(null);
  const [session, setSession] = useState<PairedSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const target = { sessionKey, ...(agentId ? { agentId } : {}) };
    const [list, row] = await Promise.all([
      engine.request("session.members.list", target),
      engine.request("sessions.describe", { key: sessionKey, ...(agentId ? { agentId } : {}) }),
    ]);
    setSession(readPairedSession(row));
    setState(readSharing(list, rec(rec(row).session).visibility));
  }, [engine, sessionKey, agentId]);
  useEffect(() => {
    load().catch((e: unknown) => setError(reason(e)));
  }, [load]);
  const change = (method: string, params: Record<string, unknown>) => {
    setError(null);
    engine.request(method, { sessionKey, ...(agentId ? { agentId } : {}), ...params }).then(load).catch((e: unknown) => setError(reason(e)));
  };
  return { state, session, error, change, reload: load };
}

export function ShareDialog({ engine, sessionKey, agentId, sessionId, title, publicLink, onCopy, onClose, clear }: Props) {
  const pill = onPill(clear);
  const { state, session, error, change, reload } = useSharing(engine, sessionKey, agentId);
  const can = state?.canChange ?? false;
  const draft = state?.visibility === "draft";
  const levels = state ? VISIBILITY_WORDS.filter(([v]) => state.allowed.includes(v)) : [];
  const at = levels.findIndex(([v]) => v === state?.visibility);
  return (
    <Dialog title={`Share ${title}`} wide onClose={onClose} footer={<button type="button" className="btn primary" onClick={onClose}>Done</button>} testid="share-dialog" clear={clear}>
      {state ? (
        <div className="share-b">
          <div className="share-row">
            <b className={pill()}>Everyone else on this Branch</b>
            {/* The raised pill sits under the chosen level; with none chosen (a draft) it is hidden. */}
            <div className={at < 0 ? "seg share-none" : "seg"} role="radiogroup" aria-label="Everyone else on this Branch" style={{ ["--i" as string]: Math.max(at, 0), ["--n" as string]: levels.length || 1 }}>
              {levels.map(([v, words]) => (
                <button key={v} type="button" role="radio" aria-checked={state.visibility === v} className={state.visibility === v ? "on" : ""} disabled={!can}
                  onClick={() => change("session.visibility.set", { visibility: v })}>{words}</button>
              ))}
            </div>
            <small className={pill("hint")}>The people below can still be added one by one.</small>
          </div>
          {state.allowed.includes("draft") ? (
            <div className="share-row share-sw">
              <span><b className={pill()}>Keep it a draft</b><small className={pill("hint")}>Only you and the owner see it until you publish.</small></span>
              <Toggle label="Keep it a draft" on={draft} disabled={!can} onChange={(on) => change("session.visibility.set", { visibility: on ? "draft" : publishedVisibility(state.allowed) })} />
            </div>
          ) : null}
          {state.owner ? <div className="share-row"><small className={pill("hint")}>Owner</small><b className={pill()}>{state.owner.name}</b></div> : null}
          <People state={state} can={can} change={change} clear={clear} />
          <PublicLink clear={clear} token={state.publicToken} can={can && Boolean(sessionId)} link={publicLink} onCopy={onCopy}
            onSet={(enabled) => change("session.publicShare.set", { expectedSessionId: sessionId, enabled })} />
          {session ? <PairedComputers engine={engine} sessionKey={sessionKey} agentId={agentId} session={session} allowed={state.allowed} can={can} clear={clear} onChanged={reload} /> : null}
          <p className={pill("hint")} data-lines={clear ? "" : undefined}>They see who started it, who owns it, and who else is in it. Their drafts stay private until they send.</p>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}

function PairedComputers({ engine, sessionKey, agentId, session, allowed, can, clear, onChanged }: {
  engine: WindowEngine; sessionKey: string; agentId?: string; session: PairedSession; allowed: readonly string[]; can: boolean; clear?: boolean; onChanged: () => Promise<void>;
}) {
  const pill = onPill(clear);
  const [plug, setPlug] = useState<{ groups: string[]; enabled: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadGroups = useCallback(async () => {
    const store = configStore(engine);
    const ok = await store.load();
    if (!ok || !store.snap) throw new Error(store.error ?? "Branch didn’t send the settings.");
    setPlug({ groups: shareGroupsOf(store.snap), enabled: pairedShareEnabled(store.snap) });
  }, [engine]);
  useEffect(() => {
    loadGroups().catch((e: unknown) => setError(reason(e)));
  }, [loadGroups]);
  const block = pairedShareBlock(sessionKey, session);
  const published = plug !== null && pairedSharePublished(session, plug.groups, plug.enabled);
  const draftHeld = session.visibility === "draft" && !can;
  const hint = block ?? (draftHeld
    ? "A draft stays on this computer until someone who may publish it does."
    : plug === null ? (error ? "Paired computers could not be read." : "Reading which groups paired computers can see.") : pairedShareHint(session, published));
  const turn = (on: boolean) => {
    if (busy || block || draftHeld) return;
    setBusy(true);
    setError(null);
    const group = pairedShareGroup(session);
    const run = async () => {
      if (on && session.visibility === "draft") {
        await engine.request("session.visibility.set", { sessionKey, ...(agentId ? { agentId } : {}), visibility: publishedVisibility(allowed) });
      }
      if (on && session.category !== group) {
        await engine.request("sessions.patch", { key: sessionKey, ...(agentId ? { agentId } : {}), category: group });
      }
      const store = configStore(engine);
      await store.load();
      if (!store.snap?.hash) throw new Error(store.error ?? "Branch didn’t send a settings revision.");
      const write = pairedShareWrites(store.snap, group, on);
      await store.set(PAIRED_SHARE_GROUPS_PATH, write.groups);
      if (write.enabled !== undefined) await store.set(PAIRED_SHARE_ENABLED_PATH, write.enabled);
      await onChanged();
      await loadGroups();
    };
    run().catch((e: unknown) => setError(reason(e))).finally(() => setBusy(false));
  };
  return (
    <div className="share-row">
      <div className="share-sw">
        <span>
          <b className={pill()}>Paired computers</b>
          <small className={pill("hint")}>{hint}</small>
        </span>
        {block ? null : (
          <Coming need={PAIRED_SHARE_NEED} reason="Branch can’t share a conversation with a paired computer.">
            <Toggle label="Let paired computers read it" on={published} disabled={busy || plug === null || draftHeld} onChange={turn} />
          </Coming>
        )}
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function People({ state, can, change, clear }: { state: Sharing; can: boolean; change: (m: string, p: Record<string, unknown>) => void; clear?: boolean }) {
  const pill = onPill(clear);
  if (!state.people.length) return <p className={pill("hint")}>No one else is paired with this Branch yet.</p>;
  return (
    <ul className="share-people">
      {state.people.map((p) => {
        const member = state.members.has(p.id);
        return (
          <li key={p.id}>
            <span className="share-av" aria-hidden="true">{p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
            <b>{clear ? <span className="g-label">{p.name}</span> : p.name}</b>
            <span className="share-sw">
              <small className={pill()}>{member ? "In it" : "No"}</small>
              <Toggle label={`${p.name} is in this conversation`} on={member} disabled={!can}
                onChange={(on) => change(on ? "session.members.add" : "session.members.remove", { identityId: p.id })} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PublicLink({ token, can, link, onCopy, onSet, clear }: { token: string | null; can: boolean; link: (t: string) => string; onCopy: (text: string) => void; onSet: (enabled: boolean) => void; clear?: boolean }) {
  const pill = onPill(clear);
  return (
    <div className="share-row">
      <b className={pill()}>Public link</b>
      <small className={pill("hint")}>{token ? "Anyone with the link can read the conversation's text without signing in. Tools, thinking, files and widgets are left out." : "Only people with access can see it."}</small>
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
