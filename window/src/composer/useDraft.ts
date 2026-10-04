// The complete draft is saved per conversation before an update can restart Branch.
import { useCallback, useEffect, useRef, useState } from "react";
import { pastedTextFile, readDraftFile, type AttachmentPolicy, type DraftFile } from "./attachments";
import { loadDraftSnapshot, safeStorage, saveDraftSnapshot, setInputPrivacy, inputPrivacy, hasDraftInput, type InputPrivacy, type DraftSnapshot } from "./drafts";
import { registerInputCheckpoint, registerVolatileInput, updateBlocked } from "../connect/update-barrier";
import { MENTION_PEOPLE_MAX } from "./mention";
import type { Person } from "./DockRow";

const empty = (): DraftSnapshot => ({ text: "", files: [], people: [] });
function read(key: string | null): DraftSnapshot { return key ? loadDraftSnapshot(safeStorage(), key) : empty(); }

export function useDraft(sessionKey: string | null, policy: AttachmentPolicy | undefined, privacy: InputPrivacy = "unknown") {
  const [draft, setDraft] = useState(() => read(sessionKey));
  const [preparing, setPreparing] = useState(0);
  const [note, setNote] = useState("");
  const current = useRef({ key: sessionKey, draft });
  const pending = useRef(new Set<Promise<void>>());
  const save = useCallback((key: string | null, next: DraftSnapshot) => {
    if (!key) return;
    try { saveDraftSnapshot(safeStorage(), key, next); }
    catch { setNote("Your draft is here, but it couldn't be saved on this computer. Branch will wait before updating."); }
  }, []);
  const change = useCallback((fn: (d: DraftSnapshot) => DraftSnapshot, key = current.current.key) => {
    const next = fn(key === current.current.key ? current.current.draft : read(key));
    save(key, next);
    if (key === current.current.key) { current.current.draft = next; setDraft(next); }
  }, [save]);
  useEffect(() => {
    const next = read(sessionKey);
    current.current = { key: sessionKey, draft: next };
    setDraft(next);
  }, [sessionKey]);
  useEffect(() => {
    if (!sessionKey) return;
    setInputPrivacy(sessionKey, privacy);
    save(sessionKey, current.current.draft);
  }, [sessionKey, privacy, save]);
  useEffect(() => registerVolatileInput(() => !current.current.key && (hasDraftInput(current.current.draft) || pending.current.size > 0)), []);
  useEffect(() => registerInputCheckpoint(async () => {
    await Promise.all([...pending.current]);
    if (current.current.key) saveDraftSnapshot(safeStorage(), current.current.key, current.current.draft);
  }), []);
  const setText = useCallback((text: string) => change((d) => ({ ...d, text })), [change]);
  const addFiles = useCallback(async (list: File[], origin: DraftFile["origin"]) => {
    if (!list.length) return;
    if (updateBlocked()) { setNote("Branch is updating. Attach this file once it is back online."); return; }
    const key = current.current.key;
    setPreparing((n) => n + list.length);
    const job = Promise.all(list.map((f) => readDraftFile(crypto.randomUUID(), f, origin, policy))).then((files) => {
      change((d) => ({ ...d, files: [...d.files, ...files] }), key);
    }).finally(() => { setPreparing((n) => n - list.length); });
    pending.current.add(job);
    const unregisterVolatile = registerVolatileInput(() => !key || inputPrivacy(key) !== "ordinary");
    const unregister = registerInputCheckpoint(async () => {
      await job;
      if (key) saveDraftSnapshot(safeStorage(), key, read(key));
    });
    try { await job; } finally { pending.current.delete(job); unregister(); unregisterVolatile(); }
  }, [change, policy]);
  const addPastedText = useCallback((text: string) => change((d) => ({ ...d, files: [...d.files, pastedTextFile(crypto.randomUUID(), text)] })), [change]);
  const addPerson = useCallback((person: Person) => change((d) => {
    if (d.people.some((p) => p.profileId === person.profileId)) return d;
    if (d.people.length >= MENTION_PEOPLE_MAX) { setNote("You can mention up to 10 people in one message."); return d; }
    return { ...d, people: [...d.people, person] };
  }), [change]);
  const clear = useCallback(() => { change(empty); setNote(""); }, [change]);
  return {
    ...draft, setText, preparing, note, setNote, addFiles, addPastedText, addPerson, clear,
    clearSent: (sent: DraftSnapshot) => { if (current.current.draft === sent) clear(); },
    snapshot: () => current.current.draft,
    removeFile: (id: string) => change((d) => ({ ...d, files: d.files.filter((f) => f.id !== id) })),
    takeFile: (id: string) => {
      const file = current.current.draft.files.find((f) => f.id === id);
      change((d) => ({ ...d, files: d.files.filter((f) => f.id !== id) }));
      return file;
    },
    forget: (profileId: string) => change((d) => ({ ...d, people: d.people.filter((p) => p.profileId !== profileId) })),
  };
}

/** chat.send's `mentions`: where each told person's "@Name" sits in the words (engine HumanMentionSchema). */
export function mentionsIn(text: string, people: readonly Person[]): Array<{ profileId: string; start: number; end: number }> {
  return people.flatMap((p) => {
    const start = text.indexOf(`@${p.name}`);
    return start < 0 ? [] : [{ profileId: p.profileId, start, end: start + p.name.length + 1 }];
  });
}
