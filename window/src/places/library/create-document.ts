// Preview 40-places newdocD18: the first free Untitled document name, then unsent help.
// agents.documents.create performs the exclusive durable write; the acknowledgement owns the file path.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { loadDraft, safeStorage, saveDraft } from "../../composer/drafts";
import { errorText, rec, trunkName, type Trunk } from "./data";

const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
export type CreatedDocument = { agentId: string; file: { name: string; path: string; size: number; hash: string } };

function confirmed(result: unknown, agentId: string, name: string): CreatedDocument {
  const value = rec(result), file = rec(value.file);
  if (value.agentId !== agentId || file.name !== name || file.path !== `Documents/${name}` || file.size !== 0 || file.hash !== EMPTY_HASH) {
    throw new Error("The engine did not confirm the new blank document in this Trunk's Documents folder.");
  }
  return { agentId, file: { name, path: file.path, size: file.size, hash: file.hash } };
}

export async function createUntitledDocument(engine: WindowEngine, agentId: string, current: () => boolean): Promise<CreatedDocument | null> {
  let number = 1;
  while (current()) {
    const name = number === 1 ? "Untitled document.md" : `Untitled document ${number}.md`;
    const path = `Documents/${name}`;
    try {
      const result = await engine.request<unknown>("agents.documents.create", { agentId, name, content: "" });
      return current() ? confirmed(result, agentId, name) : null;
    } catch (error) {
      if (!current()) return null;
      const details = rec(rec(error).details);
      if (details.type !== "document_conflict" || details.path !== path) throw error;
      number++;
    }
  }
  return null;
}

/** Never opens/sends a conversation or replaces any existing text, chips, or waiting messages. */
export function stageDocumentHelp(engine: WindowEngine, agentId: string, mainKey: string, name: string): string {
  const key = `agent:${agentId}:${mainKey}`;
  const temporary = /^agent:[^:]+:(?:dashboard|subagent|internal-session-effects):incognito-[^:]+$/iu;
  if (temporary.test((engine.sessionKey ?? "").trim()) || temporary.test(key.trim())) {
    return "Help was not saved outside your temporary conversation.";
  }
  try {
    const storage = safeStorage();
    if (!storage) return "The unsent help draft could not be saved: storage is unavailable.";
    if (loadDraft(storage, key)) return "Your existing draft was kept; no help message was added.";
    const text = `Help me write “${name}”: `;
    saveDraft(storage, key, text);
    return loadDraft(storage, key) === text ? "The unsent help draft is ready in this Trunk's conversation." : "The unsent help draft could not be saved.";
  } catch {
    return "The unsent help draft could not be saved: storage is unavailable.";
  }
}

type CreationOptions = { engine: WindowEngine; trunks: Trunk[]; defaultId?: string; mainKey?: string; location: string; onCreated: (document: CreatedDocument, trunk: string) => void };
type Notice = { engine: WindowEngine; agentId: string; error?: string; note?: string };

export function useCreateDocument({ engine, trunks, defaultId, mainKey, location, onCreated }: CreationOptions) {
  const [chosen, setChosen] = useState<{ engine: WindowEngine; id: string } | null>(null);
  const preferred = trunks.some(t => t.id === engine.agentId) ? engine.agentId : defaultId;
  const selected = chosen?.engine === engine ? chosen.id : preferred ?? "";
  const target = trunks.find(t => t.id === selected);
  const scopes = engine.scopes.join(","), ids = trunks.map(t => t.id).join(",");
  const lifetime = useRef<{ active: boolean } | null>(null), pending = useRef(false);
  const context = JSON.stringify([selected, scopes, ids, mainKey, location]);
  const [working, setWorking] = useState<{ engine: WindowEngine; context: string; ticket: { active: boolean } } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    const ticket = { active: true }; lifetime.current = ticket;
    pending.current = false;
    return () => { ticket.active = false; };
  }, [engine, selected, scopes, ids, mainKey, location]);
  const reason = !engine.scopes.includes("operator.admin") ? "Needs operator.admin access to create a document."
    : !target ? "Choose a Trunk for the new document." : !mainKey ? "The engine has not provided this Trunk's contact key." : "";
  async function create() {
    const ticket = lifetime.current, sourceKey = engine.sessionKey, sourceAgent = engine.agentId;
    if (reason || !target || !mainKey || pending.current || !ticket?.active) return;
    const current = () => ticket.active && lifetime.current === ticket && engine.scopes.includes("operator.admin") && engine.sessionKey === sourceKey && engine.agentId === sourceAgent;
    pending.current = true; setWorking({ engine, context, ticket }); setNotice(null);
    try {
      const document = await createUntitledDocument(engine, target.id, current);
      if (!document || !current()) return;
      const help = stageDocumentHelp(engine, target.id, mainKey, document.file.name);
      setNotice({ engine, agentId: target.id, note: `Created “${document.file.name}”. ${help}` });
      onCreated(document, trunkName(target));
    } catch (error) {
      if (current()) setNotice({ engine, agentId: target.id, error: errorText(error) });
    } finally {
      if (current()) { pending.current = false; setWorking(null); }
    }
  }
  const mine = notice?.engine === engine && notice.agentId === selected && engine.scopes.includes("operator.admin") ? notice : null;
  const busy = working?.engine === engine && working.context === context && working.ticket.active;
  return { selected, choose: (id: string) => setChosen({ engine, id }), create, busy, reason, error: mine?.error, note: mine?.note };
}
