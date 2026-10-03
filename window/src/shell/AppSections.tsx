// Other apps' conversations in the list (§4.1.1 "other apps' sections", the preview's appSectionsPA18): one folded
// section per assistant the engine reads (sessions.catalog.list; Settings › Data & usage switches them on). Its ⋯ has
// View options and Hide from the sidebar; each row opens read only (sessions.catalog.read), and "Bring it in"
// copies it into Branch (sessions.catalog.import).
import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";
import { rowTime } from "./list-model";
import type { MenuItem } from "./Menu";
import { notify } from "./notify";

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type CatalogThread = { catalogId: string; hostId: string; threadId: string; sourceHomeId?: string; name: string; at: number; canArchive: boolean; canContinue: boolean };
export type Catalog = { id: string; label: string; threads: CatalogThread[] };

export function readCatalogs(result: unknown): Catalog[] {
  const list = Array.isArray(rec(result).catalogs) ? (rec(result).catalogs as unknown[]).map(rec) : [];
  return list.map((c) => ({
    id: str(c.id),
    label: str(c.label) || str(c.id),
    threads: (Array.isArray(c.hosts) ? (c.hosts as unknown[]).map(rec) : []).flatMap((h) =>
      (Array.isArray(h.sessions) ? (h.sessions as unknown[]).map(rec) : [])
        .filter((s) => s.archived !== true)
        .map((s) => ({
          catalogId: str(c.id),
          hostId: str(h.hostId),
          threadId: str(s.threadId),
          ...(str(s.sourceHomeId) ? { sourceHomeId: str(s.sourceHomeId) } : {}),
          name: str(s.name) || str(s.threadId),
          at: Number(s.recencyAt ?? s.updatedAt ?? s.createdAt) || 0,
          canArchive: s.canArchive === true,
          canContinue: s.canContinue === true,
        })),
    ),
  })).filter((c) => c.id);
}

const HIDDEN_KEY = "branch.appsHidden";
const OPEN_KEY = "branch.appsOpen";
const readSet = (key: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set(); // storage blocked or damaged: nothing hidden, every section folded
  }
};
const saveSet = (key: string, set: Set<string>) => {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // storage blocked: the choice lasts for this window only
  }
};

const locator = (t: CatalogThread) => ({ catalogId: t.catalogId, hostId: t.hostId, threadId: t.threadId, ...(t.sourceHomeId ? { sourceHomeId: t.sourceHomeId } : {}) });

export const TERMINAL_OFF = "Opening another assistant's conversation in a terminal needs the Branch app on your computer.";

/** The catalogs and what can be done with them. */
export function useCatalogs(request: Request, ready: boolean) {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [hidden, setHidden] = useState(() => readSet(HIDDEN_KEY));
  const [open, setOpen] = useState(() => readSet(OPEN_KEY));
  const load = useCallback(() => {
    request("sessions.catalog.list", { limitPerHost: 50 }).then(
      (r) => setCatalogs(readCatalogs(r)),
      (e: unknown) => console.warn("sessions.catalog.list failed", e),
    );
  }, [request]);
  useEffect(() => {
    if (ready) load();
  }, [ready, load]);
  const hide = (id: string, label: string) => {
    const next = new Set(hidden).add(id);
    setHidden(next);
    saveSet(HIDDEN_KEY, next);
    notify(`${label} hidden. Show it again in Settings › Appearance › The list.`, {
      action: { label: "Undo", run: () => setHidden((cur) => { const back = new Set(cur); back.delete(id); saveSet(HIDDEN_KEY, back); return back; }) },
    });
  };
  const fold = (id: string) => {
    const next = new Set(open);
    if (!next.delete(id)) next.add(id);
    setOpen(next);
    saveSet(OPEN_KEY, next);
  };
  const bringIn = async (t: CatalogThread): Promise<string | null> => {
    try {
      const r = rec(await request("sessions.catalog.import", { ...locator(t), displayName: t.name.slice(0, 500) }));
      notify(r.created === false ? "Already up to date." : `Brought in ${Number(r.importedItems) || 0} messages.`); // fakes-ok: F4 the preview's own words (app-latest ACTS.extinPA18)
      return str(r.sessionKey) || null;
    } catch (e) {
      notify(`Couldn't bring it in: ${reason(e)}.`, { tone: "bad" });
      return null;
    }
  };
  const remove = async (t: CatalogThread) => {
    try {
      await request("sessions.catalog.archive", { ...locator(t), confirmNoOtherRunner: true });
      notify(`Deleted ${t.name}.`);
      load();
    } catch (e) {
      notify(`Couldn't delete ${t.name}: ${reason(e)}.`, { tone: "bad" });
    }
  };
  return { catalogs: catalogs.filter((c) => !hidden.has(c.id) && c.threads.length), open, fold, hide, bringIn, remove, reload: load };
}

type Catalogs = ReturnType<typeof useCatalogs>;
type Props = {
  data: Catalogs;
  now: number;
  onMenu: (e: MouseEvent<HTMLElement>, id: string, items: MenuItem[], label: string) => void;
  onRead: (t: CatalogThread, label: string) => void;
  onDelete: (t: CatalogThread, label: string) => void;
};

function threadMenu(t: CatalogThread, label: string, p: Props): MenuItem[] {
  return [
    { label: "Open", run: () => p.onRead(t, label) },
    { label: "Bring it in", run: () => void p.data.bringIn(t) },
    { label: "Open in a terminal", run: () => undefined, disabled: TERMINAL_OFF },
    { kind: "sep" },
    t.canArchive ? { label: "Delete…", danger: true, run: () => p.onDelete(t, label) } : { label: "Delete…", danger: true, run: () => undefined, disabled: `${label} doesn't let Branch delete this conversation.` },
  ];
}

export function AppSections(p: Props) {
  return (
    <>
      {p.data.catalogs.map((c) => {
        const isOpen = p.data.open.has(c.id);
        const menu: MenuItem[] = [
          { kind: "sub", label: "View options", items: [{ kind: "head", label: "Open them in" }, { kind: "info", label: "Branch", checked: true }, { label: "A terminal", run: () => undefined, disabled: TERMINAL_OFF }] },
          { label: "Hide from the sidebar", run: () => p.data.hide(c.id, c.label) },
        ];
        return (
          <section key={c.id} className="list-sec app-sec" data-section={`app:${c.id}`}>
            <div className="lh-row">
              <button type="button" className="lf" aria-expanded={isOpen} aria-label={`${isOpen ? "Fold" : "Unfold"} ${c.label}`} onClick={() => p.data.fold(c.id)}>
                <Icon name={isOpen ? "down" : "chev"} size={12} />
              </button>
              <span className="lh">{c.label}</span>
              {isOpen ? null : <span className="lc">{c.threads.length}</span>}
              <button type="button" className="lg" aria-label={`More for ${c.label}`} title="More" aria-haspopup="menu" onClick={(e) => p.onMenu(e, `app:${c.id}`, menu, c.label)}>
                <Icon name="more" size={12} />
              </button>
            </div>
            {isOpen
              ? c.threads.map((t) => (
                  <div key={t.threadId} className="rw">
                    <div className="row one ext" onContextMenu={(e) => (e.preventDefault(), p.onMenu(e, `ext:${t.threadId}`, threadMenu(t, c.label, p), t.name))}>
                      <button type="button" className="row-open" onClick={() => p.onRead(t, c.label)}>
                        <span className="row-av"><span className="exav" aria-hidden="true"><Icon name="term" size={15} /></span></span>
                        <b className="row-name"><span className="nm"><span className="nm-t">{t.name}</span></span></b>
                        <span className="rc"><time className="row-time">Last active {rowTime(t.at, p.now)}</time></span>
                      </button>
                      <span className="row-acts">
                        <button type="button" className="ib sm" aria-label="More" title="More" onClick={(e) => p.onMenu(e, `ext:${t.threadId}`, threadMenu(t, c.label, p), t.name)}>
                          <Icon name="more" small />
                        </button>
                      </span>
                    </div>
                  </div>
                ))
              : null}
          </section>
        );
      })}
    </>
  );
}

type Item = { who: string; text: string };

/** A conversation another assistant keeps, read only, with "Bring it in". */
export function ReadOnlyThread({ request, thread, label, onClose, onBringIn }: { request: Request; thread: CatalogThread; label: string; onClose: () => void; onBringIn: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    request("sessions.catalog.read", { ...locator(thread), limit: 200 }).then(
      (r) => setItems((Array.isArray(rec(r).items) ? (rec(r).items as unknown[]).map(rec) : [])
        .filter((i) => (str(i.type) === "userMessage" || str(i.type) === "agentMessage") && str(i.text).trim())
        .map((i) => ({ who: str(i.type) === "userMessage" ? "You" : label, text: str(i.text) }))),
      (e: unknown) => setError(`Couldn't read it: ${reason(e)}.`),
    );
  }, [request, thread, label]);
  return (
    <Dialog title={thread.name} wide onClose={onClose} testid="ext-thread" footer={<><button type="button" className="btn ghost" onClick={onClose}>Close</button><button type="button" className="btn primary" onClick={onBringIn}>Bring it in</button></>}>
      <div className="exts" role="note">
        <Icon name="eye" small />
        <span>This conversation belongs to {label} and can only be read here.</span>
      </div>
      {error ? <p className="dlg-p">{error}</p> : items === null ? <p className="dlg-p">Reading…</p> : items.length === 0 ? <p className="dlg-p">Nothing to read yet.</p> : (
        <div className="ext-items">
          {items.map((i, n) => (
            <div key={n} className="ext-item">
              <b>{i.who}</b>
              <p>{i.text}</p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
