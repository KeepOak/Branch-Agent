// Instructions & personality › Just about you (§4.7.5): the person's own USER.md for this Trunk (users.personalFile.*),
// at most 4,000 characters (the engine's own limit). The engine offers it only while more than one person uses
// Branch; on a one-person Branch it refuses, and the section stays away, as in the preview.
import { useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { record, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Btn, Hint, Plist, Sec } from "../kit";
import { AskFoot, closer, ConflictBox, lineCount, linesText, saveKeys, useDraft, useFocusText, type Doc } from "./instructions-editor";

export const YOU_MAX = 4000;

function docOf(r: unknown): Doc {
  const v = record(r);
  return { content: typeof v.content === "string" ? v.content : "", hash: typeof v.hash === "string" ? v.hash : null, missing: v.missing === true };
}

export function JustAboutYou({ engine, agentId }: { engine: WindowEngine; agentId: string }) {
  const file = useResource<RecordValue>(engine, "users.personalFile.get", { agentId });
  const last = useRef<Doc | null>(null);
  const [open, setOpen] = useState(false);
  if (file.data) last.current = docOf(file.data);
  if (file.error || !last.current) return null;
  const doc = last.current;
  const n = lineCount(doc.content);
  return (
    <Sec title="Just about you">
      <Plist>
        <div className="prow if-row" data-row="Just about you">
          <span className="if-name" title="USER.md">About you</span>
          <span className="grow"><b>Just about you</b><small>Yours: what this Trunk should know about you. Only you and it read it.{n ? ` · ${linesText(n)}` : ""}</small></span>
          <Btn sm onClick={() => setOpen(true)}>{n ? "Edit" : "Write"}</Btn>
        </div>
      </Plist>
      <Hint>The shared About you instructions above stay the household’s.</Hint>
      {open ? <YouEditor engine={engine} agentId={agentId} start={doc} onClose={(saved) => { setOpen(false); if (saved) void file.reload(); }} /> : null}
    </Sec>
  );
}

type EdProps = { engine: WindowEngine; agentId: string; start: Doc; onClose: (saved: boolean) => void };
function YouEditor({ engine, agentId, start, onClose }: EdProps) {
  const d = useDraft(start, {
    load: async () => docOf(await engine.request("users.personalFile.get", { agentId })),
    save: (content, on) => engine.request("users.personalFile.set", { agentId, content, expectedHash: on.hash }),
  }, () => onClose(true));
  const ref = useFocusText();
  const n = d.text.length, over = n > YOU_MAX;
  const can = !over && !d.busy && !d.conflict;
  const foot = d.ask
    ? <AskFoot d={d} question="Discard your changes and load the saved file?" onDiscard={() => onClose(false)} />
    : <><Btn ghost onClick={() => void d.reload()}>Reload</Btn><span className="grow" /><Btn ghost onClick={closer(d, () => onClose(false))}>Cancel</Btn><Btn pri disabled={!can} onClick={() => void d.save()}>Save</Btn></>;
  return (
    <Dialog title={`About you · just about you${d.dirty ? " · unsaved" : ""}`} wide onClose={closer(d, () => onClose(false))} footer={foot} testid="just-about-you">
      <div className="if-ed" onKeyDown={saveKeys(d, can)}>
        <ConflictBox d={d} />
        <textarea ref={ref} className="inp if-text" rows={12} spellCheck={false} aria-label="USER.md, just about you" value={d.text} onChange={(e) => d.setText(e.target.value)} />
        <div className="if-count">
          <p className="hint" aria-live="polite">{over ? "Shorten it to 4,000 characters to save." : `${n.toLocaleString("en-US")} / 4,000 characters. Keep it short: what you prefer, your context, how you work.`}</p>
          {d.base.missing ? <p className="hint">It’s made when you save.</p> : null}
        </div>
        {d.error ? <p className="if-error" role="alert">{d.error}</p> : null}
      </div>
    </Dialog>
  );
}
