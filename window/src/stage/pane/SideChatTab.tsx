import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { SIcon } from "../stage-icons";

type Exchange = { question: string; answer: string; ts: number };
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Side chat: quick questions about this conversation that don't go into it (sessions.companion.*). */
export function SideChatTab({ engine, name }: { engine: WindowEngine; name: string }) {
  const [list, setList] = useState<Exchange[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    engine.request<{ exchanges?: Exchange[] }>("sessions.companion.state", { sessionKey: engine.sessionKey }).then(
      (r) => live && setList(Array.isArray(r?.exchanges) ? r.exchanges : []),
      (e: unknown) => {
        if (!live) return;
        setList([]);
        setError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [engine]);
  const ask = () => {
    const question = text.trim().slice(0, 400);
    if (!question) return;
    setBusy(true);
    setError("");
    engine.request<{ answer: string; ts: number }>("sessions.companion.ask", { sessionKey: engine.sessionKey, question }).then(
      (r) => {
        setList((l) => [...(l ?? []), { question, answer: r.answer, ts: r.ts }]);
        setText("");
        setBusy(false);
      },
      (e: unknown) => {
        setError(errorText(e));
        setBusy(false);
      },
    );
  };
  const clear = () => engine.request("sessions.companion.reset", { sessionKey: engine.sessionKey }).then(() => setList([]), (e: unknown) => setError(errorText(e)));
  return (
    <div className="side-chat-pn">
      <p className="hint-st">Ask about this conversation without adding to it. {name} keeps working.</p>
      <div className="side-msgs-pn">
        {list === null ? <p className="hint-st">Reading…</p> : null}
        {list?.map((x) => (
          <div key={x.ts} className="side-x-pn">
            <div className="dk7-m me7">{x.question}</div>
            <div className="dk7-m">{x.answer}</div>
          </div>
        ))}
      </div>
      {error ? <p className="err-st" role="alert">{error}</p> : null}
      <form className="dk7-in" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={400} placeholder={`Ask about ${name}'s work`} aria-label="Ask in the side chat" disabled={busy} />
        <button type="submit" className="send-st" aria-label="Ask" disabled={busy || !text.trim()}>
          <SIcon name={busy ? "spin" : "up"} small className={busy ? "spin-st" : undefined} />
        </button>
      </form>
      {list?.length ? (
        <button type="button" className="link" onClick={() => void clear()}>
          Clear the side chat
        </button>
      ) : null}
    </div>
  );
}
