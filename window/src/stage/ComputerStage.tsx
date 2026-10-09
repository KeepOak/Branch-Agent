// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserView, NO_MARKUP, type BrowserPhase } from "./BrowserView";
import { profileLine, recordedBrowserTabs, routeOf } from "./browser-route";
import { readLevel } from "../places-nav/SettingsFrame";
import type { Block } from "../thread/model";
import type { WindowEngine } from "../connect/engine";
import type { ProgressCard } from "../thread/PlanCard";
import { Menu, type MenuAnchor, type MenuItem } from "../shell/Menu";
import { SIcon } from "./stage-icons";
import { useDesktopView, type DesktopView } from "./use-desktop";
import { announceComputerControl, listenComputerControl } from "../thread/computer-card";
import { describePlacement, listComputers, pickerLabel, placementComputer, planSteps, stagePill, type Computer, type Placement, type PlanStep } from "./computers";
import { ComputerPicker } from "./ComputerPicker";
import { AddComputer } from "./AddComputer";
import { configStore } from "../places/settings/config-store";
import { NativeScreen } from "./NativeScreen";
import "./stage.css";

export type StageMode = "Computer" | "Browser";

const NO_PAUSE = "The engine has no per-run pause and resume method.";
const NO_NUMBERS = "The engine can't number what it may click on a computer screen yet.";
const NO_RECORD = "The engine can't record what you do on a computer yet.";
const NO_WINDOW = "The engine can't show one window of a computer yet.";
const OWN_WINDOW = "This window can't open the computer in a window of its own yet.";

type Where = { placement: Placement | undefined; computers: Computer[]; profiles: { id: string; name: string }[]; loaded: boolean; error?: string };

/** Where this conversation runs and the computers the engine knows, re-read after a move or an added computer. */
function useWhere(engine: WindowEngine, tick: number): Where {
  const [where, setWhere] = useState<Where & { owner: WindowEngine; tick: number }>({ owner: engine, tick, placement: undefined, computers: [], profiles: [], loaded: false });
  useEffect(() => {
    let live = true;
    void Promise.allSettled([describePlacement(engine), listComputers(engine)]).then(([placement, list]) => {
      if (!live) return;
      const failed = [placement, list].find((result) => result.status === "rejected");
      setWhere({ owner: engine, tick, loaded: true,
        placement: placement.status === "fulfilled" ? placement.value : undefined,
        ...(list.status === "fulfilled" ? list.value : { computers: [], profiles: [] }),
        ...(failed?.status === "rejected" ? { error: failed.reason instanceof Error ? failed.reason.message : String(failed.reason) } : {}),
      });
    });
    return () => {
      live = false;
    };
  }, [engine, tick]);
  return where.owner === engine && where.tick === tick ? where : { placement: undefined, computers: [], profiles: [], loaded: false };
}

function StepStrip({ steps, controlling, running, connected, onWatch, watchOpen, tools }: { steps: PlanStep[]; controlling: boolean; running: boolean; connected: boolean; onWatch: (at: MenuAnchor) => void; watchOpen: boolean; tools: boolean }) {
  return (
    <div className="st7-steps">
      {steps.map((s, i) => (
        <span key={i} className={`st7-chip ${s.state}`}>
          <em>{i + 1}</em>
          {s.text}
        </span>
      ))}
      <span className="st7-chip live7" aria-pressed="true">
        {running && !controlling ? <i /> : null}
        {running && !controlling ? "Live" : "Now"}
      </span>
      {tools ? (
        <span className="tools-st" role="group" aria-label="The computer view's tools">
          <button type="button" className="st7-chip tool-st" aria-haspopup="menu" aria-expanded={watchOpen} aria-label="What to watch: Whole screen" disabled={!connected} title={connected ? undefined : "Nothing is connected."} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onWatch({ x: r.left, y: r.top - 8 }); }}>
            <SIcon name="window" small />
            <span className="tlab-st">Whole screen</span>
            <SIcon name="down" small />
          </button>
          <button type="button" className="st7-chip tool-st" aria-label="Number what it can click" disabled title={NO_NUMBERS}>
            <SIcon name="hash" small />
            <span className="tlab-st">Numbers</span>
          </button>
          <button type="button" className="st7-chip tool-st" aria-label="Record what you do" disabled title={NO_RECORD}>
            <SIcon name="record" small />
            <span className="tlab-st">Record</span>
          </button>
        </span>
      ) : null}
    </div>
  );
}

function Screen({ view, target, onRetry, onChoose, controlling, onEnable, enabling, enableError }: { view: DesktopView; target: React.RefObject<HTMLDivElement | null>; onRetry: () => void; onChoose: () => void; controlling: boolean; onEnable?: () => void; enabling?: boolean; enableError?: string }) {
  return (
    <div className="st7-wrap">
      <div className={controlling ? "st7-screen live-st ctl-st" : "st7-screen live-st"}>
        <div className="stage-screen" ref={target} />
        {controlling && view.phase === "connected" ? <span className="drive-st">You're driving</span> : null}
        {view.phase !== "connected" ? (
          <div className="stage-empty">
            <SIcon name="monitor" />
            <b>
              {view.phase === "loading"
                ? "Connecting to this conversation's computer…"
                : view.phase === "error"
                  ? "Couldn't connect to the computer"
                  : "It can't see a screen or use a mouse."}
            </b>
            {view.message ? <p role="alert">{view.message}</p> : null}
            {enableError ? <p role="alert">{enableError}</p> : null}
            {view.phase === "error" ? (
              <button type="button" className="btn" onClick={onRetry}>
                Try again
              </button>
            ) : null}
            {view.phase !== "loading" ? (
              <button type="button" className="btn" disabled={enabling} onClick={onEnable ?? onChoose}>
                {onEnable ? enabling ? "Turning on screen access…" : "See the screen and use the mouse" : "Computer settings"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GridCell({ engine, gatewayUrl, computer, onOpen }: { engine: WindowEngine; gatewayUrl: string; computer: Computer; onOpen: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const view = useDesktopView(engine, gatewayUrl, computer.id, target, false, 0);
  return (
    <button type="button" className="st7-cell" onClick={onOpen}>
      <span className="st7-screen grid7">
        <span className="stage-screen" ref={target} />
        {view.phase !== "connected" ? <span className="cell-note-st">{view.phase === "loading" ? "Connecting…" : view.message || "No screen to show"}</span> : null}
      </span>
      <span className="st7-cl">
        <SIcon name={computer.id === "gateway" ? "monitor" : "shield"} small />
        {computer.name}
        {computer.sub ? <em>{computer.sub}</em> : null}
      </span>
    </button>
  );
}

type Props = {
  engine: WindowEngine;
  gatewayUrl: string;
  name: string;
  mode: StageMode;
  blocks?: Block[];
  running?: boolean;
  card?: ProgressCard | null;
  onMode: (mode: StageMode) => void;
  onClose: () => void;
  onChooseComputer: () => void;
  /** Shrinks the stage to a small window over the conversation, showing this computer. */
  onPip?: (small: PipTarget) => void;
  /** Opens on this computer instead of the conversation's own (the "branch:watch-computer" event). */
  initialComputer?: string | null;
  /** Opens already taken over ("Take over" on the conversation's computer card). */
  initialControl?: boolean;
};

/** What the small window over the conversation shows: a computer's screen, or the browser (the preview's S.pip.kind). */
export type PipTarget = { kind: "computer" | "browser"; id: string; name: string };

/** A conversation's computer and browser, full size beside the one main conversation and composer. */
export function ComputerStage({ engine, gatewayUrl, name, mode, blocks = [], running = false, card = null, onMode, onClose, onChooseComputer, onPip, initialComputer = null, initialControl = false }: Props) {
  const [control, setControl] = useState(initialControl);
  const [retry, setRetry] = useState(0);
  const [tick, setTick] = useState(0);
  const [picked, setPicked] = useState<string | "grid" | null>(initialComputer);
  const [picker, setPicker] = useState<MenuAnchor | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; items: MenuItem[]; label: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [stopError, setStopError] = useState("");
  const [browserPhase, setBrowserPhase] = useState<BrowserPhase>("empty");
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState("");
  const [nativeLive, setNativeLive] = useState(false);
  const [nativeSelected, setNativeSelected] = useState(false);
  const target = useRef<HTMLDivElement>(null);
  const where = useWhere(engine, tick);
  useEffect(() => {
    const changed = () => setTick((t) => t + 1);
    window.addEventListener("branch:computers-changed", changed);
    return () => window.removeEventListener("branch:computers-changed", changed);
  }, []);
  useEffect(() => {
    announceComputerControl(control);
  }, [control]);
  useEffect(() => listenComputerControl((next) => setControl((cur) => (cur === next ? cur : next))), []);
  useEffect(() => () => announceComputerControl(false), []);
  const current = placementComputer(where.placement);
  const screens = where.computers.filter((c) => c.desktop || c.id === current);
  const viewing = picked === "grid" ? null : picked ?? current;
  const viewed = where.computers.find((c) => c.id === viewing);
  const native = mode === "Computer" && nativeSelected && viewing === "gateway" && where.loaded && !viewed?.desktop;
  const view = useDesktopView(engine, gatewayUrl, mode === "Computer" && !native && picked !== "grid" && where.loaded ? viewing : null, target, control, retry);
  const screenView: DesktopView = !where.loaded ? { phase: "loading" } : where.error && !viewing ? { phase: "error", message: where.error } : view;
  const steps = planSteps(card);
  const browser = mode === "Browser";
  const controlling = browser ? control : view.phase === "connected" && view.controlling === true;
  const connected = browser ? browserPhase === "connected" : native ? nativeLive : view.phase === "connected";
  const browserLine = useMemo(() => profileLine(routeOf(recordedBrowserTabs(blocks))), [blocks]);
  const pill = stagePill(running, controlling, steps);
  const onBrowserState = useCallback((phase: BrowserPhase) => setBrowserPhase(phase), []);
  const enableScreen = () => {
    if (enabling) return;
    setEnabling(true);
    setEnableError("");
    void configStore(engine).set("plugins.entries.cua-computer.enabled", true).then(() => {
      setNativeSelected(true);
      setPicked("gateway");
      setRetry((value) => value + 1);
    }, () => setEnableError("Couldn't turn on screen access. Open Computer settings and try again.")).finally(() => setEnabling(false));
  };
  const stop = () => {
    setStopError("");
    engine.request("sessions.abort", { key: engine.sessionKey }).catch((e: unknown) => setStopError(e instanceof Error ? e.message : String(e)));
  };
  const watchMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "What to watch",
      items: [
        { kind: "head", label: `What to watch on ${view.title || viewed?.name || "this computer"}` },
        { kind: "info", label: "Whole screen", checked: true },
        { kind: "sep" },
        { kind: "head", label: "One window" },
        { label: "Pick a window", run: () => undefined, disabled: NO_WINDOW },
      ],
    });
  const moreMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "More for this view",
      items: [{ label: "Disconnect", run: () => onClose(), disabled: connected ? undefined : "Nothing is connected." }],
    });
  const title = `${name}’s ${browser ? "browser" : "computer"}`;
  return (
    <section className="stage7 computer-stage" aria-label={title}>
      <div className="st7-top">
        <button type="button" className="st7-back" onClick={onClose}>
          <SIcon name="back" small />
          {name}
        </button>
        <span className="st7-title">
          <b>{title}</b>
          {browser ? (
            browserLine ? (
              <span className="st7-sub">
                <SIcon name="lock" small />
                {browserLine}
              </span>
            ) : null
          ) : (
            <button type="button" className="st7-pick" aria-haspopup="dialog" aria-expanded={picker !== null} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicker(picker ? null : { x: r.left, y: r.bottom + 6 }); }}>
              <SIcon name="layers" small />
              {native ? "This computer (viewing)" : where.loaded ? pickerLabel(where.computers, current) : "Computers"}
              <SIcon name="down" small />
            </button>
          )}
        </span>
        <span className={`pill ${pill.kind}`}>
          <i />
          {pill.text}
        </span>
        <span className="tb-grow" />
        {controlling ? (
          <button type="button" className="btn pri sm" onClick={() => setControl(false)}>
            Hand back to {name}
          </button>
        ) : (
          <>
            {connected && !native ? (
              <button type="button" className="btn pri sm" onClick={() => setControl(true)}>
                Take over
              </button>
            ) : null}
            <button type="button" className="btn sm" disabled title={NO_PAUSE}>
              Pause
            </button>
            <button type="button" className="btn ghost sm" disabled={!running} title={running ? undefined : `${name} isn't working right now.`} onClick={stop}>
              Stop
            </button>
          </>
        )}
        {browser ? (
          <button type="button" className="ib" aria-label="Mark up the page" title={NO_MARKUP} disabled>
            <SIcon name="edit" />
          </button>
        ) : null}
        <span className="st7-sw" role="group" aria-label="Show">
          {(["Computer", "Browser"] as const).map((m) => (
            <button type="button" key={m} aria-pressed={mode === m} onClick={() => { setControl(false); onMode(m); }}>
              <SIcon name={m === "Computer" ? "monitor" : "globe"} small />
              {m}
            </button>
          ))}
        </span>
        <button type="button" className="ib" aria-label="Shrink to a small window" title={native ? "This screen is shown in the Computer panel." : "Picture in picture"} disabled={native || !onPip || (!browser && !viewing)} onClick={() => (browser ? onPip?.({ kind: "browser", id: "browser", name: "browser" }) : viewing && onPip?.({ kind: "computer", id: viewing, name: viewed?.name ?? view.title ?? viewing }))}>
          <SIcon name="pip" />
        </button>
        <button type="button" className="ib" aria-label="Open in its own window" title={OWN_WINDOW} disabled>
          <SIcon name="window" />
        </button>
        <button type="button" className="ib" aria-haspopup="menu" aria-label="More for this view" title="More" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); moreMenu({ x: r.right - 220, y: r.bottom + 6 }); }}>
          <SIcon name="more" />
        </button>
      </div>
      {stopError ? <p className="stage-error-st" role="alert">{stopError}</p> : null}
      {!browser && where.error && viewing ? <p className="stage-error-st" role="alert">{where.error} <button type="button" className="btn sm" onClick={() => setTick((value) => value + 1)}>Try again</button></p> : null}
      {!browser && screens.length > 1 ? (
        <div className="st7-tabs" role="tablist" aria-label="Its computers">
          {screens.map((c) => (
            <button type="button" role="tab" key={c.id} aria-selected={picked !== "grid" && viewing === c.id} onClick={() => { setControl(false); setPicked(c.id); }}>
              <SIcon name={c.id === "gateway" ? "monitor" : "shield"} small />
              {c.name}
              <i className={c.working || (c.id === current && running) ? "on7" : undefined} />
            </button>
          ))}
          <button type="button" role="tab" aria-selected={picked === "grid"} onClick={() => { setControl(false); setPicked("grid"); }}>
            <SIcon name="layers" small />
            All screens
          </button>
        </div>
      ) : null}
      {browser ? (
        <BrowserView
          engine={engine}
          gatewayUrl={gatewayUrl}
          blocks={blocks}
          name={name}
          running={running}
          control={control}
          onControl={setControl}
          level={readLevel()}
          onState={onBrowserState}
        />
      ) : (
      <div className="st7-body">
        {picked === "grid" ? (
          <div className="st7-wrap gridwrap7">
            <div className="st7-grid">
              {screens.map((c) => (
                <GridCell key={c.id} engine={engine} gatewayUrl={gatewayUrl} computer={c} onOpen={() => setPicked(c.id)} />
              ))}
            </div>
          </div>
        ) : native ? (
          <NativeScreen engine={engine} retry={retry} onLive={setNativeLive} onRetry={() => setRetry((value) => value + 1)} />
        ) : (
          <Screen view={screenView} target={target} controlling={controlling} onRetry={() => { setRetry((v) => v + 1); if (where.error) setTick((v) => v + 1); }} onChoose={onChooseComputer} onEnable={where.loaded && !where.error && (!viewing || viewing === "gateway") ? enableScreen : undefined} enabling={enabling} enableError={enableError} />
        )}
      </div>
      )}
      {steps.length || connected || running ? (
        <StepStrip steps={steps} controlling={controlling} running={running} connected={connected} tools={!browser && !native} watchOpen={menu?.label === "What to watch"} onWatch={watchMenu} />
      ) : null}
      {picker ? (
        <ComputerPicker
          at={picker}
          engine={engine}
          name={name}
          computers={where.computers}
          profiles={where.profiles}
          placement={where.placement}
          current={current}
          onClose={() => setPicker(null)}
          onAdd={() => { setPicker(null); setAdding(true); }}
          onManage={() => { setPicker(null); onChooseComputer(); }}
          onMoved={() => setTick((t) => t + 1)}
        />
      ) : null}
      {menu ? <Menu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
      {adding ? <AddComputer engine={engine} onClose={() => setAdding(false)} onAdded={() => undefined} /> : null}
    </section>
  );
}
