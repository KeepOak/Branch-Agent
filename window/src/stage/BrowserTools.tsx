// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Level } from "../places-nav/settings-nav";
import { browserCall, type BrowserRoute, type LiveTab } from "./browser-route";
import { SIcon } from "./stage-icons";

type DrawerTab = "sees" | "console" | "network" | "storage" | "downloads" | "tabs";
const TABS: [DrawerTab, string, number][] = [
  ["sees", "What it sees", 0],
  ["console", "Console", 1],
  ["network", "Network", 1],
  ["storage", "Cookies & storage", 1],
  ["downloads", "Downloads", 0],
  ["tabs", "Tabs", 0],
];
const LEVEL: Record<Level, number> = { regular: 0, advanced: 1, technical: 2 };
const NO_DOWNLOADS = "The engine doesn't list a browser's downloads yet.";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : []);
const time = (v: unknown) => {
  const d = new Date(str(v));
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

/** One read of a browser route, again whenever `again` changes. */
function useRead(load: () => Promise<unknown>, deps: unknown[]): { data: unknown; error: string; loading: boolean } {
  const [state, setState] = useState<{ key: string; data: unknown; error: string }>({ key: "", data: null, error: "" });
  const key = JSON.stringify(deps);
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setState({ key, data, error: "" }),
      (e: unknown) => live && setState({ key, data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? { data: state.data, error: state.error, loading: false } : { data: null, error: "", loading: true };
}

function Wait({ read, children }: { read: { error: string; loading: boolean }; children: ReactNode }) {
  if (read.loading) return <p className="muted-br"><SIcon name="spin" small className="spin-st" /> Reading…</p>;
  if (read.error) return <p className="err-st" role="alert">{read.error}</p>;
  return <>{children}</>;
}

function Sees({ engine, route, targetId, name, again }: Props & { again: number }) {
  const read = useRead(() => browserCall(engine, route, "GET", "/snapshot", { targetId, query: { format: "ai" } }), [route, targetId, again]);
  const snap = rec(read.data);
  const text = str(snap.snapshot) || str(snap.text);
  return (
    <Wait read={read}>
      <p className="lead-br">{name} reads the page as a list of what it can use, each with a short name.</p>
      {text ? <pre className="tree-br">{text}</pre> : <p className="muted-br">The page gave nothing to read.</p>}
      <p className="muted-br">What it types is hidden in logs.</p>
    </Wait>
  );
}

function Console({ engine, route, targetId, again }: Props & { again: number }) {
  const [only, setOnly] = useState<"all" | "error" | "warning">("all");
  const read = useRead(async () => {
    const [con, dialogs] = await Promise.all([
      browserCall(engine, route, "GET", "/console", { targetId }),
      browserCall(engine, route, "GET", "/dialogs", { targetId }).catch(() => null),
    ]);
    return { con, dialogs };
  }, [route, targetId, again]);
  const messages = list(rec(rec(read.data).con).messages).filter((m) => only === "all" || str(m.type) === only);
  const seen = rec(rec(rec(rec(read.data).dialogs).browserState).dialogs);
  const dialogs = [...list(seen.pending), ...list(seen.recent)];
  return (
    <Wait read={read}>
      <div className="acts-br seg-br" role="group" aria-label="Message level">
        {(["all", "error", "warning"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={only === v} onClick={() => setOnly(v)}>
            {v === "all" ? "All" : v === "error" ? "Errors" : "Warnings"}
          </button>
        ))}
      </div>
      <ul className="con-br">
        {messages.length ? (
          messages.map((m, i) => (
            <li key={i} className={str(m.type) === "error" ? "error-br" : str(m.type) === "warning" ? "warn-br" : undefined}>
              <small>{time(m.timestamp)}</small>
              <span>{str(m.text)}</span>
            </li>
          ))
        ) : (
          <li>
            <span>Nothing here.</span>
          </li>
        )}
      </ul>
      {dialogs.length ? (
        <p className="muted-br">
          <b>Page questions</b> · {dialogs.map((d) => `“${str(d.message)}” (${str(d.type) || "a question"})`).join(" · ")}
        </p>
      ) : null}
    </Wait>
  );
}

function Network({ engine, route, targetId, again }: Props & { again: number }) {
  const read = useRead(() => browserCall(engine, route, "GET", "/requests", { targetId }), [route, targetId, again]);
  const requests = list(rec(read.data).requests);
  return (
    <Wait read={read}>
      <table className="net-br">
        <thead>
          <tr>
            <th>What</th>
            <th>Status</th>
            <th>Kind</th>
          </tr>
        </thead>
        <tbody>
          {requests.length ? (
            requests.map((r, i) => (
              <tr key={str(r.id) || i} className={r.failureText ? "blk-br" : undefined}>
                <td className="mono-br">
                  {str(r.method)} {str(r.url)}
                  {r.failureText ? <span className="pill bad"> {str(r.failureText)}</span> : null}
                </td>
                <td>{str(r.status) || "—"}</td>
                <td>{str(r.resourceType)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>Nothing here.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Wait>
  );
}

function Storage({ engine, route, targetId, again, host }: Props & { again: number; host: string }) {
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const read = useRead(async () => {
    const [cookies, local, session] = await Promise.all([
      browserCall(engine, route, "GET", "/cookies", { targetId }),
      browserCall(engine, route, "GET", "/storage/local", { targetId }).catch(() => null),
      browserCall(engine, route, "GET", "/storage/session", { targetId }).catch(() => null),
    ]);
    return { cookies, local, session };
  }, [route, targetId, again, tick]);
  const d = rec(read.data);
  const cookies = list(rec(d.cookies).cookies);
  const keys = (v: unknown, kind: string) => Object.keys(rec(rec(v).values)).map((k) => [kind, k] as const);
  const stored = [...keys(d.local, "Local storage"), ...keys(d.session, "Session storage")];
  const clear = () => {
    setError("");
    Promise.all([
      browserCall(engine, route, "POST", "/cookies/clear", { targetId }),
      browserCall(engine, route, "POST", "/storage/local/clear", { targetId }),
      browserCall(engine, route, "POST", "/storage/session/clear", { targetId }),
    ]).then(() => setTick((t) => t + 1), (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <Wait read={read}>
      <p className="muted-br">For {host || "this site"}. Values stay hidden.</p>
      <table className="net-br">
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Site</th>
            <th>Ends</th>
          </tr>
        </thead>
        <tbody>
          {cookies.length ? (
            cookies.map((c, i) => (
              <tr key={i}>
                <td>
                  <b>{str(c.name)}</b> <small>{[c.secure ? "Secure" : "", c.httpOnly ? "only the site reads it" : ""].filter(Boolean).join(" · ")}</small>
                </td>
                <td>{str(c.domain)}</td>
                <td>{typeof c.expires === "number" && c.expires > 0 ? new Date(c.expires * 1000).toLocaleDateString([], { month: "short", year: "numeric" }) : "When the browser closes"}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>No cookies.</td>
            </tr>
          )}
        </tbody>
      </table>
      <ul className="ls-br">
        {stored.length ? (
          stored.map(([kind, k]) => (
            <li key={kind + k}>
              <small>{kind}</small>
              <span>{k}</span>
              <em>••••</em>
            </li>
          ))
        ) : (
          <li>
            <span>Nothing stored.</span>
          </li>
        )}
      </ul>
      <div className="acts-br">
        <button type="button" className="btn ghost sm" disabled={!cookies.length && !stored.length} onClick={clear}>
          Clear this site's data
        </button>
      </div>
      {error ? <p className="err-st" role="alert">{error}</p> : null}
    </Wait>
  );
}

function Tabs({ tabs, current, onPick, onClose }: { tabs: LiveTab[]; current: string; onPick: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <ul className="ls-br tabs-br">
      {tabs.length ? (
        tabs.map((t) => (
          <li key={t.targetId}>
            <button type="button" className="link" onClick={() => onPick(t.targetId)}>
              {t.title || "New tab"}
            </button>
            <span>{t.url}</span>
            {t.targetId === current ? <small>In front</small> : null}
            <button type="button" className="btn ghost sm" onClick={() => onClose(t.targetId)}>
              Close
            </button>
          </li>
        ))
      ) : (
        <li>
          <span>Nothing open.</span>
        </li>
      )}
    </ul>
  );
}

type Props = { engine: WindowEngine; route: BrowserRoute; targetId: string; name: string };

/** The browser's Tools drawer: what it sees, console, network, cookies and storage, downloads and tabs. */
export function BrowserTools(props: Props & { level: Level; host: string; tabs: LiveTab[]; onPick: (id: string) => void; onCloseTab: (id: string) => void; onClose: () => void }) {
  const shown = TABS.filter(([, , lv]) => LEVEL[props.level] >= lv);
  const [tab, setTab] = useState<DrawerTab>("sees");
  const [again, setAgain] = useState(0);
  const at = shown.some(([k]) => k === tab) ? tab : "sees";
  return (
    <section className="drw-br" aria-label="Browser tools">
      <div className="drw-tabs-br" role="tablist">
        {shown.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={at === k} disabled={k === "downloads"} title={k === "downloads" ? NO_DOWNLOADS : undefined} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
        <span className="tb-grow" />
        {at !== "tabs" ? (
          <button type="button" className="ib sm" aria-label="Read again" title="Read again" onClick={() => setAgain((n) => n + 1)}>
            <SIcon name="reload" small />
          </button>
        ) : null}
        <button type="button" className="ib sm" aria-label="Close the tools" title="Close" onClick={props.onClose}>
          <SIcon name="x" small />
        </button>
      </div>
      <div className="drw-body-br">
        {at === "sees" ? <Sees {...props} again={again} /> : null}
        {at === "console" ? <Console {...props} again={again} /> : null}
        {at === "network" ? <Network {...props} again={again} /> : null}
        {at === "storage" ? <Storage {...props} again={again} host={props.host} /> : null}
        {at === "tabs" ? <Tabs tabs={props.tabs} current={props.targetId} onPick={props.onPick} onClose={props.onCloseTab} /> : null}
      </div>
    </section>
  );
}
