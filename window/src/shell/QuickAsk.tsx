// Quick ask (DESIGN-SPEC §4.1.4): a box near the top of the window. It sends the question to a new conversation with
// the Trunk picked under To. Enter sends, Escape closes; an empty box says so. "Have Branch make a Trunk" is
// places/trunk's TrunkStudio.
import { useState } from "react";
import type { Trunk } from "./engine-data";
import { notify } from "./notify";
import "./quick-ask.css";

type Props = {
  trunks: Trunk[];
  defaultId: string | null;
  onSend: (text: string, agentId: string | undefined) => void;
  onClose: () => void;
};

export function QuickAsk({ trunks, defaultId, onSend, onClose }: Props) {
  const [text, setText] = useState("");
  const ordered = [...trunks].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId));
  const [to, setTo] = useState<string | undefined>(ordered[0]?.id);
  const send = () => {
    if (!text.trim()) {
      notify("Type a question first.");
      return;
    }
    onClose();
    onSend(text.trim(), to);
  };
  return (
    <div className="qa-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qa-box" role="dialog" aria-label="Quick ask" data-testid="quick-ask">
        <input
          className="qa-field"
          autoFocus
          value={text}
          placeholder="Ask anything…"
          aria-label="Ask anything"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="qa-foot">
          <span className="qa-to" role="radiogroup" aria-label="To">
            <span className="qa-to-l">To</span>
            {ordered.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={to === t.id} className="chip" onClick={() => setTo(t.id)}>
                {t.name}
              </button>
            ))}
          </span>
          <button type="button" className="btn pri sm" data-testid="quick-ask-start" onClick={send}>
            Start
          </button>
        </div>
      </div>
    </div>
  );
}
