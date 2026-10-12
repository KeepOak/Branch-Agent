// "New group chat" (DESIGN-SPEC §4.2.4 "New group chat dialog", the preview's grp-new): a name, the Trunk, the people
// and the agents on other computers, then "Start the group chat". What the engine can do today is made for real:
// sessions.create { agentId, label } for the chosen Trunk, then session.members.add for each person picked, and the
// new conversation opens. The engine gives a conversation one Trunk and takes people only as members, so a second
// Trunk, an outside agent, "Who answers" and Trunks talking in here are drawn greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "../shell/Dialog";
import { A2A_CHANNEL } from "./sender";
import "./rooms.css";
import { shownWhy } from "../shell/shown-why";

/** Both entry points (the + new menu and Customize › Trunks) open the dialog with this window event.
 *  A sidebar drop can pass the two chats so the dialog opens with them already filled in. */
export const NEW_GROUP_EVENT = "branch:new-group-chat";
export type NewGroupPrefill = { name?: string; trunk?: string; people?: string[] };
export const openNewGroupChat = (prefill?: NewGroupPrefill) => window.dispatchEvent(new CustomEvent<NewGroupPrefill | undefined>(NEW_GROUP_EVENT, { detail: prefill }));
export function readGroupPrefill(event: Event): NewGroupPrefill | undefined {
  const detail = event instanceof CustomEvent ? event.detail : undefined;
  if (!detail || typeof detail !== "object") return undefined;
  const rec = detail as Record<string, unknown>;
  const name = typeof rec.name === "string" ? rec.name : undefined;
  const trunk = typeof rec.trunk === "string" ? rec.trunk : undefined;
  const people = Array.isArray(rec.people) ? rec.people.filter((id): id is string => typeof id === "string") : undefined;
  return name || trunk || people?.length ? { ...(name ? { name } : {}), ...(trunk ? { trunk } : {}), ...(people?.length ? { people } : {}) } : undefined;
}

const NO_METHOD = "needs an engine method Branch doesn't have yet.";
export const GROUP_REASONS = {
  secondTrunk: `A second Trunk in one conversation ${NO_METHOD}`,
  agent: `Adding an agent on another computer to a conversation ${NO_METHOD}`,
  whoAnswers: `Choosing who answers in a group chat ${NO_METHOD}`,
  talk: `Letting Trunks talk to each other in one group chat ${NO_METHOD}`,
} as const;

type Option = { id: string; name: string };
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

/** The Trunks (agents.list), the other people (users.list without users.self) and the A2A peers (config). */
export function readChoices(agents: unknown, users: unknown, self: unknown, config: unknown) {
  const selfId = str(rec(rec(self).profile).id);
  const trunks = list(rec(agents).agents).map((a): Option => ({ id: str(a.id), name: str(rec(a.identity).name) || str(a.name) || str(a.id) })).filter((t) => t.id);
  const people = list(rec(users).profiles).filter((p) => str(p.id) && str(p.id) !== selfId && !str(p.mergedInto)).map((p): Option => ({ id: str(p.id), name: str(p.displayName) || str(list(p.emails)[0]) || str(p.id) }));
  const peers = Object.keys(rec(rec(rec(rec(config).config).channels)[A2A_CHANNEL]).peers ?? {}).map((name): Option => ({ id: name, name }));
  return { trunks, people, peers, defaultId: str(rec(agents).defaultId) };
}

/** Makes the group chat: the conversation, then each person as a member. Returns the new conversation's key. */
export type GroupProgress = { key: string | null; added: Set<string> };

export async function startGroupChat(engine: WindowEngine, p: { name: string; trunk: string; people: string[] }, progress: GroupProgress = { key: null, added: new Set() }): Promise<string> {
  if (!progress.key) {
    const made = rec(await engine.request("sessions.create", { agentId: p.trunk, ...(p.name ? { label: p.name } : {}) }));
    const key = str(made.key);
    if (!key) throw new Error("The engine didn't return the new conversation's key.");
    progress.key = key;
  }
  const key = progress.key;
  for (const identityId of p.people) {
    if (progress.added.has(identityId)) continue;
    await engine.request("session.members.add", { sessionKey: key, agentId: p.trunk, identityId });
    progress.added.add(identityId);
  }
  return key;
}

function Chip({ label, on, disabled, onClick }: { label: string; on: boolean; disabled?: string; onClick: () => void }) {
  return (
    <button type="button" className="rm-chip" aria-pressed={on} disabled={Boolean(disabled)} title={shownWhy(disabled)} onClick={onClick}>
      {label}
    </button>
  );
}

type Choices = ReturnType<typeof readChoices>;

function useChoices(engine: WindowEngine): { choices: Choices | null; error: string | null } {
  const [state, setState] = useState<{ choices: Choices | null; error: string | null }>({ choices: null, error: null });
  useEffect(() => {
    let live = true;
    const quiet = (p: Promise<unknown>) => p.catch(() => ({}));
    Promise.all([engine.request("agents.list", {}), quiet(engine.request("users.list", {})), quiet(engine.request("users.self", {})), quiet(engine.request("config.get", {}))]).then(
      ([a, u, s, c]) => live && setState({ choices: readChoices(a, u, s, c), error: null }),
      (e: unknown) => live && setState({ choices: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine]);
  return state;
}

export function NewGroupChat({ engine, onClose, onOpen, prefill }: { engine: WindowEngine; onClose: () => void; onOpen: (key: string) => void; prefill?: NewGroupPrefill }) {
  const { choices, error } = useChoices(engine);
  const [name, setName] = useState(prefill?.name ?? "");
  const [trunk, setTrunk] = useState<string | null>(prefill?.trunk ?? null);
  const [people, setPeople] = useState<string[]>(prefill?.people ?? []);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const progress = useRef<GroupProgress>({ key: null, added: new Set() });
  const starting = useRef(false);
  const locked = busy || Boolean(progress.current.key);
  const lockedReason = locked ? "Finish adding the people to this conversation before changing it." : undefined;
  const picked = trunk ?? choices?.defaultId ?? choices?.trunks[0]?.id ?? null;
  const start = async () => {
    if (starting.current) return;
    if (!picked) {
      setFail("Pick at least one Trunk.");
      return;
    }
    setBusy(true);
    starting.current = true;
    setFail(null);
    try {
      const key = await startGroupChat(engine, { name: name.trim(), trunk: picked, people }, progress.current);
      onClose();
      onOpen(key);
    } catch (e) {
      setFail(e instanceof Error ? e.message : String(e));
      setBusy(false);
    } finally {
      starting.current = false;
    }
  };
  const footer = (
    <>
      <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn pri" disabled={busy || !choices} onClick={() => void start()}>Start the group chat</button>
    </>
  );
  return (
    <Dialog title="New group chat" wide onClose={onClose} footer={footer} testid="new-group-chat">
      <label className="rm-fld">
        <span>Name</span>
        <input className="inp" autoFocus placeholder="September close" value={name} disabled={locked} onChange={(e) => setName(e.target.value)} />
      </label>
      {error ? <p role="alert" className="rm-fail">{error}</p> : null}
      {!choices && !error ? <p role="status" className="rm-hint">Loading…</p> : null}
      {choices ? (
        <>
          <div className="rm-fld">
            <span>Trunks · one to six</span>
            <span className="rm-chips">{choices.trunks.map((t) => <Chip key={t.id} label={t.name} on={t.id === picked} disabled={lockedReason} onClick={() => setTrunk(t.id)} />)}</span>
            {choices.trunks.length > 1 ? <small className="rm-hint">{GROUP_REASONS.secondTrunk}</small> : null}
          </div>
          <div className="rm-fld">
            <span>People</span>
            <span className="rm-chips">
              {choices.people.length ? choices.people.map((p) => <Chip key={p.id} label={p.name} on={people.includes(p.id)} disabled={lockedReason} onClick={() => setPeople((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))} />) : <small className="rm-hint">No one else uses this Branch yet.</small>}
            </span>
          </div>
          {choices.peers.length ? (
            <div className="rm-fld">
              <span>Agents on other computers</span>
              <span className="rm-chips">{choices.peers.map((p) => <Chip key={p.id} label={p.name} on={false} disabled={GROUP_REASONS.agent} onClick={() => undefined} />)}</span>
            </div>
          ) : null}
          <div className="rm-row" title={GROUP_REASONS.whoAnswers}>
            <span>
              <b>Who answers</b>
              <small>Nobody mentioned means everyone.</small>
            </span>
            <span className="rm-seg" role="radiogroup" aria-label="Who answers">
              {["Only those you @mention", "A lead Trunk decides", "Everyone, every time"].map((l) => <button key={l} type="button" role="radio" aria-checked={false} disabled>{l}</button>)}
            </span>
          </div>
          <div className="rm-row" title={GROUP_REASONS.talk}>
            <span>
              <b>Trunks may talk to each other in here</b>
              <small>Up to 4 rounds and 32 Trunk turns for each of yours. A Trunk can pass.</small>
            </span>
            <button type="button" role="switch" className="switch" aria-checked={false} aria-label="Trunks may talk to each other in here" disabled />
          </div>
        </>
      ) : null}
      {fail ? <p role="alert" className="rm-fail">{fail}</p> : null}
    </Dialog>
  );
}

/** Mounted once by the shell: opens the dialog when either entry point asks. */
export function NewGroupChatHost({ engine, onOpen }: { engine: WindowEngine | undefined; onOpen: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<NewGroupPrefill | undefined>();
  useEffect(() => {
    const show = (event: Event) => {
      setPrefill(readGroupPrefill(event));
      setOpen(true);
    };
    window.addEventListener(NEW_GROUP_EVENT, show);
    return () => window.removeEventListener(NEW_GROUP_EVENT, show);
  }, []);
  return open && engine ? <NewGroupChat key={`${prefill?.name ?? ""}:${prefill?.trunk ?? ""}`} engine={engine} onClose={() => setOpen(false)} onOpen={onOpen} prefill={prefill} /> : null;
}
