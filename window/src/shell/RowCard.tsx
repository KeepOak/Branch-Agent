// The conversation card on hover or keyboard focus (DESIGN-SPEC §4.1.1.1, the preview's cardPA18): glass, at most
// 340 px, beside the list; it never takes focus. Its facts come from the engine row; at Advanced its "Latest" lines
// come from sessions.preview.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Conversation } from "../connect/conversations";
import { Pebble } from "../face/Pebble";
import { badgeList, type RowExtras } from "./ConversationRow";
import { rowCardPosition, rowDisplayName } from "./sidebar-row";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type Line = { role: string; text: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** What kind of conversation it is, in the card's words. */
export function kindWords(row: Conversation): string {
  if (row.kind === "group") return "Group chat";
  if (row.parentKey) return "Thread";
  return "Direct chat";
}

/** The last lines of a conversation (sessions.preview), oldest first; empty when the engine has none. */
function useLatest(request: Request, row: Conversation, on: boolean): Line[] {
  const [lines, setLines] = useState<Line[]>([]);
  useEffect(() => {
    if (!on) return;
    let live = true;
    request("sessions.preview", { keys: [row.key], limit: 20, maxChars: 240 }).then(
      (r) => {
        const entry = (Array.isArray(rec(r).previews) ? (rec(r).previews as unknown[]) : []).map(rec).find((p) => str(p.key) === row.key);
        const items = Array.isArray(entry?.items) ? (entry.items as unknown[]).map(rec) : [];
        if (live) setLines(items.filter((i) => (str(i.role) === "user" || str(i.role) === "assistant") && str(i.text).trim()).map((i) => ({ role: str(i.role), text: str(i.text).replace(/\s+/g, " ").trim() })));
      },
      () => live && setLines([]),
    );
    return () => {
      live = false;
    };
  }, [request, row.key, on]);
  return lines;
}

type Props = {
  row: Conversation;
  anchor: HTMLElement;
  request: Request;
  trunkName: string;
  personName: string;
  project: string | null;
  advanced: boolean;
  extras?: RowExtras;
};

function Kv({ k, v }: { k: string; v: string | null | undefined }) {
  return v ? (
    <div className="kv-c">
      <span>{k}</span>
      <b>{v}</b>
    </div>
  ) : null;
}

export function RowCard({ row, anchor, request, trunkName, personName, project, advanced, extras }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const latest = useLatest(request, row, advanced);
  useLayoutEffect(() => {
    const el = ref.current;
    const side = anchor.closest(".side")?.getBoundingClientRect();
    if (!el || !side) return;
    const thread = anchor.ownerDocument.querySelector(".v23-threads:not(.v23-threads-hidden), .topicsT5")?.getBoundingClientRect() ?? null;
    const r = anchor.getBoundingClientRect();
    setPos(rowCardPosition({
      anchor: r,
      sidebar: side,
      thread,
      card: { width: el.offsetWidth, height: el.offsetHeight },
      viewport: { width: innerWidth, height: innerHeight },
    }));
  }, [anchor, latest.length]);
  const marks = badgeList(row, extras).map((b) => b.words);
  return (
    <div ref={ref} className="row-card" role="tooltip" id="row-card" data-testid="row-card" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      <div className="cdh">
        <b>{rowDisplayName(row.title, trunkName) || trunkName || "New conversation"}</b>
        <small>{kindWords(row)}</small>
      </div>
      <div className="cdt">
        <Pebble size={22} label={trunkName} state="idle" priority={50} />
        <span>{trunkName}</span>
      </div>
      {advanced ? (
        <>
          <Kv k="Project" v={project} />
          <Kv k="Folder" v={row.folder} />
          <Kv k="Branch" v={row.repoBranch} />
          <Kv k="Runs on" v={row.execNode ?? (row.folder || row.repoBranch ? "This computer" : null)} />
        </>
      ) : null}
      {row.runMark && row.runError ? <Kv k="Stopped" v={row.runError} /> : null}
      {marks.length ? <Kv k="Marks" v={marks.join(" · ")} /> : null}
      {advanced && latest.length ? (
        <div className="cdx">
          <div className="ph">Latest</div>
          {latest.map((l, i) => (
            <div key={i} className="cdmsg">
              {l.role === "user" ? <span className="who-dot sm" aria-hidden="true">{personName.slice(0, 1).toUpperCase()}</span> : <Pebble size={18} label={trunkName} state="idle" priority={50} />}
              <div>
                <b>{l.role === "user" ? personName : trunkName}</b>
                <p>{l.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
