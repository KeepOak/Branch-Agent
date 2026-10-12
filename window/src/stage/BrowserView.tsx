// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import type { Level } from "../places-nav/settings-nav";
import type { BrowserPresentation } from "../thread/browser-presentation";
import { Menu, type MenuAnchor, type MenuItem } from "../shell/Menu";
import { BrowserScreencastClient, type BrowserScreencastFrame } from "./browser-screencast-client";
import { browserCall, readTabs, recordedBrowserTabs, routeKey, routeOf, scopedBrowserRequest, type BrowserRoute, type LiveTab } from "./browser-route";
import { BrowserTools } from "./BrowserTools";
import { SIcon } from "./stage-icons";

export { recordedBrowserTabs, scopedBrowserRequest } from "./browser-route";

export function browserRemotePoint(
  rect: { left: number; top: number; width: number; height: number },
  image: { width: number; height: number; cssWidth: number; cssHeight: number },
  x: number,
  y: number,
) {
  const scale = Math.min(rect.width / image.width, rect.height / image.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const left = rect.left + (rect.width - image.width * scale) / 2,
    top = rect.top + (rect.height - image.height * scale) / 2;
  const px = (x - left) / (image.width * scale),
    py = (y - top) / (image.height * scale);
  if (px < 0 || py < 0 || px > 1 || py > 1) return null;
  return { x: Math.round(px * image.cssWidth), y: Math.round(py * image.cssHeight) };
}

export type BrowserPhase = "loading" | "empty" | "connected" | "error";
export const NO_MARKUP = "Marking up a page needs a way to send the drawing to the chat, which the window doesn't have yet.";

type Browser = { key: string; phase: "none" | "loading" | "stopped" | "ready" | "error"; tabs: LiveTab[]; error?: string };

/** The route's status (GET /) and this conversation's tabs (GET /tabs), read again whenever `tick` changes. */
function useBrowser(engine: WindowEngine, route: BrowserRoute | null, tick: number): Browser {
  const key = `${engine.sessionKey}|${routeKey(route)}|${tick}`;
  const [state, setState] = useState<Browser>({ key: "", phase: "loading", tabs: [] });
  useEffect(() => {
    if (!route || !engine.sessionKey) return;
    let live = true;
    (async () => {
      const status = await browserCall<{ running?: boolean }>(engine, route, "GET", "/");
      if (!status?.running) return { key, phase: "stopped" as const, tabs: [] };
      return { key, phase: "ready" as const, tabs: readTabs(await browserCall(engine, route, "GET", "/tabs")) };
    })().then(
      (next) => live && setState(next),
      (e: unknown) => live && setState({ key, phase: "error", tabs: [], error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine, route, key]);
  if (!route || !engine.sessionKey) return { key, phase: "none", tabs: [] };
  return state.key === key ? state : { key, phase: "loading", tabs: state.key.startsWith(`${engine.sessionKey}|${routeKey(route)}|`) ? state.tabs : [] };
}

type ViewState = { owner: WindowEngine; selection: string; phase: BrowserPhase; url?: string; title?: string; message?: string };

/** The live picture of one tab (POST /screencast) on a canvas; clicks and keys go to /act only while `interact`. */
function Screencast({ engine, gatewayUrl, entry, interact, onState }: { engine: WindowEngine; gatewayUrl: string; entry: BrowserPresentation | null; interact: boolean; onState: (s: Omit<ViewState, "owner" | "selection">) => void }) {
  const selection = entry ? `${routeKey(entry.tab)}:${entry.tab.targetId}:${entry.revision}` : "";
  const canvas = useRef<HTMLCanvasElement>(null);
  const metrics = useRef<{ width: number; height: number; cssWidth: number; cssHeight: number } | null>(null);
  const generation = useRef(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<ViewState>({ owner: engine, selection, phase: entry ? "loading" : "empty" });
  const current = state.owner === engine && state.selection === selection ? state : { owner: engine, selection, phase: entry ? ("loading" as const) : ("empty" as const) };
  useEffect(() => {
    const operation = ++generation.current;
    let active = true,
      stream: BrowserScreencastClient | undefined,
      pending: BrowserScreencastFrame | undefined,
      decoding = false;
    metrics.current = null;
    const isCurrent = () => active && operation === generation.current;
    const present = (value: Omit<ViewState, "owner" | "selection">) => {
      if (isCurrent()) {
        setState({ owner: engine, selection, ...value });
        onState(value);
      }
    };
    const clear = () => {
      const el = canvas.current;
      if (el) el.getContext("2d")?.clearRect(0, 0, el.width, el.height);
    };
    clear();
    if (!entry || !engine.sessionKey) {
      present({ phase: "empty" });
      return () => {
        active = false;
        ++generation.current;
      };
    }
    const retire = (message: string) => {
      if (!isCurrent()) return;
      present({ phase: "error", message });
      active = false;
      ++generation.current;
      pending = undefined;
      metrics.current = null;
      clear();
      stream?.close();
    };
    let latestTitle = entry.title;
    present({ phase: "loading", title: entry.title, url: entry.url });
    const decode = async () => {
      if (decoding) return;
      decoding = true;
      try {
        while (pending && isCurrent()) {
          const frame = pending;
          pending = undefined;
          const bitmap = await createImageBitmap(frame.blob);
          try {
            if (!isCurrent()) return;
            const el = canvas.current;
            if (!el) return;
            el.width = bitmap.width;
            el.height = bitmap.height;
            el.getContext("2d")?.drawImage(bitmap, 0, 0);
            metrics.current = { width: bitmap.width, height: bitmap.height, cssWidth: frame.cssWidth, cssHeight: frame.cssHeight };
            present({ phase: "connected", url: frame.url, title: latestTitle });
          } finally {
            bitmap.close();
          }
        }
      } catch {
        retire("The browser frame could not be read.");
      } finally {
        decoding = false;
      }
    };
    void (async () => {
      try {
        const response = (await scopedBrowserRequest(engine, entry, "POST", "/screencast", { maxWidth: 1600, maxHeight: 1200 })) as { wsPath?: unknown; targetId?: unknown };
        if (!isCurrent()) return;
        if (typeof response.wsPath !== "string" || !response.wsPath || response.targetId !== entry.tab.targetId) throw Error("The browser stream did not match the recorded tab.");
        stream = new BrowserScreencastClient({
          gatewayUrl,
          wsPath: response.wsPath,
          onReady: (meta) => {
            latestTitle = meta.title;
            if (meta.targetId !== entry.tab.targetId) {
              retire("The browser stream selected a different tab.");
              return;
            }
            if (isCurrent()) setState((old) => ({ ...old, title: meta.title, url: meta.url }));
          },
          onMeta: (meta) => {
            latestTitle = meta.title;
            if (isCurrent()) {
              setState((old) => ({ ...old, title: meta.title, url: meta.url }));
              onState({ phase: "connected", title: meta.title, url: meta.url });
            }
          },
          onFrame: (frame) => {
            if (!isCurrent()) return;
            pending = frame;
            void decode();
          },
          onClose: () => retire("The browser stream closed. Try again to reconnect."),
        });
      } catch {
        present({ phase: "error", message: "This browser stream couldn't connect. Check this conversation's browser connection, then try again." });
      }
    })();
    return () => {
      active = false;
      ++generation.current;
      pending = undefined;
      stream?.close();
      metrics.current = null;
      clear();
    };
    // `entry` is identified by `selection`; onState is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, gatewayUrl, selection, retry]);
  const act = async (body: Record<string, unknown>) => {
    if (!entry || !interact || current.phase !== "connected") return;
    const operation = generation.current;
    try {
      await scopedBrowserRequest(engine, entry, "POST", "/act", body);
    } catch {
      if (operation === generation.current) setState((old) => ({ ...old, message: "The browser input couldn't be sent. Check the connection and try again." }));
    }
  };
  return (
    <div className="br-page-st">
      <canvas
        ref={canvas}
        aria-label="Live browser page"
        tabIndex={interact ? 0 : -1}
        onClick={(e) => {
          if (!interact || !metrics.current) return;
          const point = browserRemotePoint(e.currentTarget.getBoundingClientRect(), metrics.current, e.clientX, e.clientY);
          if (point) {
            e.currentTarget.focus();
            void act({ kind: "clickCoords", ...point });
          }
        }}
        onKeyDown={(e) => {
          if (!interact || e.ctrlKey || e.metaKey || e.altKey || e.key === "Escape" || e.key === "Tab") return;
          if (e.key.length === 1 || ["Enter", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
            e.preventDefault();
            void act({ kind: "press", key: e.key });
          }
        }}
        onPaste={(e) => {
          if (!interact) return;
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          if (text) void act({ kind: "insertText", text });
        }}
      />
      {current.phase === "loading" || current.phase === "error" ? (
        <div className="blank-st">
          <SIcon name="globe" />
          <b>{current.phase === "loading" ? "Connecting to the recorded browser tab…" : "Couldn't connect to the browser"}</b>
          {current.message ? <small role="alert">{current.message}</small> : null}
          {current.phase === "error" ? (
            <button type="button" className="btn sm" onClick={() => setRetry((v) => v + 1)}>
              Try again
            </button>
          ) : null}
        </div>
      ) : current.message ? (
        <p role="alert" className="browser-input-error">
          {current.message}
        </p>
      ) : null}
    </div>
  );
}

function Blank({ icon = "globe", title, text, children }: { icon?: "globe" | "lock"; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="br-page-st">
      <div className="blank-st">
        <SIcon name={icon} />
        <b>{title}</b>
        <small>{text}</small>
        {children}
      </div>
    </div>
  );
}

type Props = {
  engine: WindowEngine;
  gatewayUrl: string;
  blocks: Block[];
  name?: string;
  running?: boolean;
  /** You have the page: clicks and keys go to it. */
  control?: boolean;
  onControl?: (control: boolean) => void;
  level?: Level;
  onState: (phase: BrowserPhase, title?: string) => void;
};

/** The conversation's browser: its tabs, the address bar, the live page, the Tools drawer and the page menu. */
/** The browser in the small window over the conversation (the preview's pip7 with kind "browser"): the newest tab the
 *  Trunk used, live and look-only; a line when nothing is open. */
export function BrowserMini({ engine, gatewayUrl, blocks }: { engine: WindowEngine; gatewayUrl: string; blocks: Block[] }) {
  const entries = useMemo(() => recordedBrowserTabs(blocks), [blocks]);
  const route = useMemo(() => routeOf(entries), [routeKey(routeOf(entries))]); // eslint-disable-line react-hooks/exhaustive-deps
  const browser = useBrowser(engine, route, 0);
  const [phase, setPhase] = useState<BrowserPhase>("empty");
  const newest = entries.at(-1)?.tab.targetId;
  const tab = browser.tabs.find((t) => t.targetId === newest) ?? browser.tabs[0];
  const entry: BrowserPresentation | null = route && tab ? { tab: { ...route, targetId: tab.targetId } as BrowserPresentation["tab"], revision: "0", url: tab.url, title: tab.title } : null;
  const onState = useCallback((v: { phase: BrowserPhase }) => setPhase(v.phase), []);
  return (
    <>
      {entry ? <Screencast engine={engine} gatewayUrl={gatewayUrl} entry={entry} interact={false} onState={onState} /> : null}
      {!entry || phase !== "connected" ? <span className="cell-note-st">{!route ? "Nothing open" : browser.phase === "stopped" ? "The browser isn’t running" : "Connecting…"}</span> : null}
    </>
  );
}

export function BrowserView({ engine, gatewayUrl, blocks, name = "It", running = false, control = false, onControl, level = "regular", onState }: Props) {
  const entries = useMemo(() => recordedBrowserTabs(blocks), [blocks]);
  // Before the first tool call, use only Branch's managed browser, never the user's Chrome.
  const route = useMemo<BrowserRoute>(() => routeOf(entries) ?? { target: "host", profile: "branch" }, [routeKey(routeOf(entries))]); // eslint-disable-line react-hooks/exhaustive-deps
  const steps = blocks.filter((b) => b.kind === "step").length;
  const [tick, setTick] = useState(0);
  const browser = useBrowser(engine, route, tick + steps);
  const [picked, setPicked] = useState("");
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [address, setAddress] = useState<{ for: string; text: string } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState<{ at: MenuAnchor; items: MenuItem[] } | null>(null);
  const [note, setNote] = useState("");
  const [opening, setOpening] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const currentEngine = useRef(engine);
  useEffect(() => {
    currentEngine.current = engine;
    setOpening(false);
    setClosed(new Set());
    setAddress(null);
    setPicked("");
    setMine(new Set());
    setNote("");
  }, [engine]);
  const [find, setFind] = useState<string | null>(null);
  const [view, setView] = useState<{ owner: WindowEngine; tabId?: string; url?: string; title?: string; phase: BrowserPhase }>({ owner: engine, phase: "empty" });
  const recordedNewest = entries.at(-1)?.tab.targetId;
  const tabs = browser.tabs.filter((t) => !closed.has(t.targetId));
  const tab = tabs.find((t) => t.targetId === picked) ?? tabs.find((t) => t.targetId === recordedNewest) ?? tabs[0];
  const entry: BrowserPresentation | null = route && tab ? { tab: { ...route, targetId: tab.targetId } as BrowserPresentation["tab"], revision: String(tick), url: tab.url, title: tab.title } : null;
  const onView = useCallback(
    (s: { phase: BrowserPhase; url?: string; title?: string }) => {
      setView({ ...s, owner: engine, tabId: tab?.targetId });
      onState(s.phase, s.title);
    },
    [engine, tab?.targetId, onState],
  );
  const currentView = view.owner === engine && view.tabId === tab?.targetId ? view : { phase: "empty" as const };
  useEffect(() => {
    if (browser.phase === "none" || browser.phase === "stopped" || (browser.phase === "ready" && !browser.tabs.length)) onState("empty");
    if (browser.phase === "error") onState("error");
  }, [browser.phase, browser.tabs.length, onState]);
  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : String(e));
  const call = (method: "GET" | "POST" | "DELETE", path: string, options: Parameters<typeof browserCall>[4] = {}) => {
    if (!route) return Promise.resolve(null);
    setNote("");
    return browserCall(engine, route, method, path, options);
  };
  const refresh = () => setTick((t) => t + 1);
  const url = currentView.phase === "connected" && currentView.url ? currentView.url : tab?.url ?? "";
  const shownAddress = address && address.for === (tab?.targetId ?? "") ? address.text : url === "about:blank" ? "" : url;
  const openTab = async (target: string) => {
    if (opening || !engine.sessionKey) return;
    setOpening(true);
    onControl?.(true);
    try {
      const result = await call("POST", "/tabs/open", { body: { url: target } });
      if (currentEngine.current !== engine) return;
      const id = String((result as { targetId?: unknown } | null)?.targetId ?? "");
      if (!id) throw Error("The browser didn't open a tab. Try opening the page again.");
      setMine((m) => new Set(m).add(id));
      setPicked(id);
      setAddress(null);
      refresh();
    } catch (e) {
      if (currentEngine.current === engine) fail(e);
    } finally {
      if (currentEngine.current === engine) setOpening(false);
    }
  };
  const go = (raw: string) => {
    const target = raw.trim();
    if (!target || opening) return;
    const destination = /^[a-z][a-z0-9+.-]*:/i.test(target) ? target : `https://${target}`;
    if (!tab) {
      void openTab(destination);
      return;
    }
    onControl?.(true);
    void call("POST", "/navigate", { targetId: tab.targetId, body: { url: destination } }).then(() => {
      setAddress(null);
      refresh();
    }, fail);
  };
  const history = (step: "back" | "forward") => {
    if (!tab) return;
    onControl?.(true);
    void call("POST", "/act", { targetId: tab.targetId, body: { kind: "evaluate", fn: `() => history.${step}()` } }).then(refresh, fail);
  };
  const newTab = () => void openTab("about:blank");
  const closeTab = (id: string) => {
    onControl?.(true);
    setClosed((old) => new Set(old).add(id));
    void call("DELETE", `/tabs/${encodeURIComponent(id)}`).then(() => {
      if (currentEngine.current === engine) refresh();
    }, (e) => {
      if (currentEngine.current !== engine) return;
      setClosed((old) => { const next = new Set(old); next.delete(id); return next; });
      fail(e);
    });
  };
  const pageMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      items: [
        { kind: "head", label: "This page" },
        { label: "Take a screenshot", run: () => void call("POST", "/screenshot", { targetId: tab?.targetId }).then((r) => setNote(`Saved the screenshot to ${String((r as { path?: unknown } | null)?.path ?? "the browser's folder")}.`), fail) },
        { label: "Save as PDF", run: () => void call("POST", "/pdf", { targetId: tab?.targetId }).then((r) => setNote(`Saved the page as a PDF to ${String((r as { path?: unknown } | null)?.path ?? "the browser's folder")}.`), fail) },
        { label: "Find on this page", run: () => setFind("") },
        { kind: "info", label: "Screenshots black out password boxes." },
      ],
    });
  const findText = (text: string) => {
    if (!tab || !text) return;
    void call("POST", "/act", { targetId: tab.targetId, body: { kind: "evaluate", fn: `() => window.find(${JSON.stringify(text)})` } }).then(
      (r) => setNote(rec(r).result === false ? `“${text}” isn't on this page.` : ""),
      fail,
    );
  };
  const working = running && !control;
  let page: ReactNode;
  if (opening) page = <Blank title="Opening your page…" text="Starting the browser and connecting this conversation's tab." />;
  else if (!engine.sessionKey) page = <Blank title="Choose a conversation first" text="Open a conversation to browse pages with its Trunk." />;
  else if (browser.phase === "loading" && !browser.tabs.length) page = <Blank title="Connecting to the browser…" text="Reading this conversation's tabs." />;
  else if (browser.phase === "error") page = <Blank title="Couldn't connect to the browser" text={browser.error ?? ""}><button type="button" className="btn sm" onClick={refresh}>Try again</button></Blank>;
  else if (!tab || tab.url === "about:blank") page = <Blank title="Browse with your Trunk" text="See the pages your Trunk opens, or open a page yourself in this conversation.">
    <small>Enter a website address above and press Enter. Then ask {name} to read, compare or work on the page, or click and type yourself.</small>
    <small>Branch's browser is separate from your personal browser.</small>
  </Blank>;
  else page = <Screencast key={entry ? `${routeKey(route)}:${tab.targetId}` : "none"} engine={engine} gatewayUrl={gatewayUrl} entry={entry} interact={control} onState={onView} />;
  const showChrome = Boolean(engine.sessionKey);
  return (
    <div className="browser-st">
      {tab ? (
        <div className="bar-br" role="toolbar" aria-label="Browser tools">
          <button type="button" className="btn ghost sm tb-br" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); pageMenu({ x: r.left, y: r.bottom + 6 }); }}>
            <SIcon name="doc" small />
            <span>Page</span>
            <SIcon name="down" small />
          </button>
          <span className="tb-grow" />
          <button type="button" className="btn ghost sm tb-br" aria-pressed={drawer} onClick={() => setDrawer((v) => !v)}>
            <SIcon name="tools" small />
            <span>Tools</span>
          </button>
        </div>
      ) : null}
      {working && currentView.phase === "connected" ? (
        <div className="bn-br" role="note">
          <i className="dot-br" />
          <span className="grow">
            <b>{name} is using this page.</b> Your clicks and typing wait while it acts.
          </span>
          <button type="button" className="btn pri sm" onClick={() => onControl?.(true)}>
            Take over
          </button>
        </div>
      ) : null}
      {find !== null ? (
        <form className="find-br" onSubmit={(e) => { e.preventDefault(); findText(find); }}>
          <input className="inp" autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find on this page" aria-label="Find on this page" />
          <button type="submit" className="btn sm" disabled={!find.trim()}>Find</button>
          <button type="button" className="ib sm" aria-label="Close find" onClick={() => setFind(null)}>
            <SIcon name="x" small />
          </button>
        </form>
      ) : null}
      {note ? <p className="stage-error-st note-br" role="status">{note}</p> : null}
      <div className="st7-body">
        <div className="br-left-st">
          <div className="st7-wrap">
            <div className={control ? "st7-screen br-screen-st ctl-st" : "st7-screen br-screen-st"}>
              {showChrome ? (
                <div className="br-chrome-st">
                  <div className="br-tabs-st" role="tablist" aria-label="Tabs">
                    {tabs.map((t) => (
                      <span key={t.targetId} className={t.targetId === tab?.targetId ? "br-tab-st on" : "br-tab-st"} title={mine.has(t.targetId) ? "Your tab" : `${name}'s tab`}>
                        <button type="button" role="tab" aria-selected={t.targetId === tab?.targetId} onClick={() => setPicked(t.targetId)}>
                          {mine.has(t.targetId) ? null : <i className="br-dot-st" />}
                          {t.title || "New tab"}
                        </button>
                        <button type="button" className="br-x-st" aria-label="Close tab" onClick={() => closeTab(t.targetId)}>
                          <SIcon name="x" small />
                        </button>
                      </span>
                    ))}
                    <button type="button" className="br-new-st" aria-label="New tab" title={opening ? "Opening a tab…" : "New tab"} disabled={opening} onClick={newTab}>
                      +
                    </button>
                  </div>
                  <form className="br-url-st" onSubmit={(e) => { e.preventDefault(); go(shownAddress); }}>
                    {tab ? <><button type="button" className="br-nav-st" aria-label="Back" title="Back" onClick={() => history("back")}>
                      <SIcon name="back" small />
                    </button>
                    <button type="button" className="br-nav-st" aria-label="Forward" title="Forward" onClick={() => history("forward")}>
                      <SIcon name="forward" small />
                    </button>
                    <button type="button" className="br-nav-st" aria-label="Reload" title="Reload" disabled={!tab || !url} onClick={() => go(url)}>
                      <SIcon name="reload" small />
                    </button></> : null}
                    <SIcon name="lock" small />
                    <input
                      className="br-addr-st"
                      value={shownAddress}
                      onChange={(e) => setAddress({ for: tab?.targetId ?? "", text: e.target.value })}
                      placeholder="Enter an address and press Enter"
                      aria-label="Enter an address and press Enter"
                      spellCheck={false}
                      autoComplete="off"
                      disabled={opening}
                    />
                    <button type="submit" className="btn sm" disabled={opening || !shownAddress.trim()} title={opening ? "Opening a page…" : !shownAddress.trim() ? "Enter a website address first" : "Open this address"}>Open</button>
                  </form>
                </div>
              ) : null}
              {page}
              {control && currentView.phase === "connected" ? <span className="drive-st">You're driving</span> : null}
            </div>
          </div>
          {drawer && route && tab ? (
            <BrowserTools engine={engine} route={route} targetId={tab.targetId} name={name} level={level} host={hostOf(url)} tabs={tabs} onPick={setPicked} onCloseTab={closeTab} onClose={() => setDrawer(false)} />
          ) : null}
        </div>
      </div>
      {menu ? <Menu at={menu.at} items={menu.items} label="This page" onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
