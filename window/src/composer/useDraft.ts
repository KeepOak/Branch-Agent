// The draft of the open conversation: its words (kept per conversation on this computer), its file chips, the
// people it tells and its reply target. Switching away and back restores the words (DESIGN-SPEC §4.3.1 rule 4).
import { useCallback, useEffect, useRef, useState } from "react";
import { pastedTextFile, readDraftFile, type AttachmentPolicy, type DraftFile } from "./attachments";
import { loadDraft, safeStorage, saveDraft } from "./drafts";
import { MENTION_PEOPLE_MAX } from "./mention";
import type { Person } from "./DockRow";

export function useDraft(sessionKey: string | null, policy: AttachmentPolicy | undefined) {
  const [text, setTextState] = useState(() => (sessionKey ? loadDraft(safeStorage(), sessionKey) : ""));
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [people, setPeople] = useState<Person[]>([]);
  const [note, setNote] = useState("");
  const keyRef = useRef(sessionKey);

  useEffect(() => {
    keyRef.current = sessionKey;
    setTextState(sessionKey ? loadDraft(safeStorage(), sessionKey) : "");
    setFiles([]);
    setPeople([]);
  }, [sessionKey]);

  const setText = useCallback((next: string) => {
    setTextState(next);
    if (keyRef.current) saveDraft(safeStorage(), keyRef.current, next);
  }, []);

  const addFiles = useCallback(
    async (list: File[], origin: DraftFile["origin"]) => {
      if (list.length === 0) return;
      setPreparing((n) => n + list.length);
      const read = await Promise.all(list.map((f) => readDraftFile(crypto.randomUUID(), f, origin, policy)));
      setPreparing((n) => n - list.length);
      setFiles((all) => [...all, ...read]);
    },
    [policy],
  );

  const addPastedText = useCallback((pasted: string) => setFiles((all) => [...all, pastedTextFile(crypto.randomUUID(), pasted)]), []);

  const addPerson = useCallback((person: Person) => {
    setPeople((all) => {
      if (all.some((p) => p.profileId === person.profileId)) return all;
      if (all.length >= MENTION_PEOPLE_MAX) {
        setNote("You can mention up to 10 people in one message.");
        return all;
      }
      return [...all, person];
    });
  }, []);

  const clear = useCallback(() => {
    setText("");
    setFiles([]);
    setPeople([]);
    setNote("");
  }, [setText]);

  return {
    text,
    setText,
    files,
    preparing,
    people,
    note,
    setNote,
    addFiles,
    addPastedText,
    addPerson,
    removeFile: (id: string) => setFiles((all) => all.filter((f) => f.id !== id)),
    takeFile: (id: string) => {
      const f = files.find((x) => x.id === id);
      setFiles((all) => all.filter((x) => x.id !== id));
      return f;
    },
    forget: (profileId: string) => setPeople((all) => all.filter((p) => p.profileId !== profileId)),
    clear,
  };
}

/** chat.send's `mentions`: where each told person's "@Name" sits in the words (engine HumanMentionSchema). */
export function mentionsIn(text: string, people: readonly Person[]): Array<{ profileId: string; start: number; end: number }> {
  return people.flatMap((p) => {
    const start = text.indexOf(`@${p.name}`);
    return start < 0 ? [] : [{ profileId: p.profileId, start, end: start + p.name.length + 1 }];
  });
}
