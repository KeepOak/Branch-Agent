// Step 2, Your models (preview item 37 step 1; HANDOFF R1-07). The rows are what branch.setup.detect really found.
// Say hello is a real model call (setup's testModel: branch.setup.verify, or branch.setup.activate for a new pick),
// never the preview's timed fetch. Continue is always allowed: a free local model is set up without an account.
// Try it with examples lists the example Trunks the engine carries (trunks.template.starters).
// A switched-on ChatGPT connection answers through Codex, which Branch doesn't ship (#589): until Codex is ready, the
// step offers the same Get Codex question as Settings › Accounts (codex-get), and Say hello asks it first. That only
// applies when the ChatGPT row is what Say hello would test (helloTarget), not when a working model is already set up.
// A sign-in made outside the window (a ChatGPT/Codex login in a browser or terminal) shows up when the window comes
// back into focus: the step looks again once per return, keeping the rows, switches and Say hello result (#589).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../composer/icons";
import { Coming } from "../../glass/coming";
import type { WindowEngine } from "../../connect/engine";
import { Logo } from "../../places/settings/set1/service";
import { SetupAddAccountDialog } from "../../setup/SetupFlow";
import { logoId } from "../../setup/steps-early";
import { NO_MODELS_ONBOARDING } from "../../composer/connect-model";
import { FreeModelSetup } from "../../composer/FreeModelSetup";
import { CODEX_DOWNLOAD_METHOD, codexDownloadOffered, useCodexDownload } from "../../places/settings/set1/codex-get";
import { helloTarget, testModel, useDetected } from "../../setup/use-setup-engine";
import { answeredBy, canSayHello, codexNeededLine, EXAMPLES_REASON, needsCodex, toggle, WAITS_FOR, type Example, type Hello } from "./model";
import { examplesErrorText, examplesHint, loadExampleTrunks } from "./try-examples";

/** Calls refresh once each time the window comes back (focus, or the page turning visible again) after it was left
 *  (blur, or hidden). Nothing while hold is set: Say hello is running or the Add an account dialog is open. */
function useLookAgainOnReturn(refresh: () => void, hold: boolean) {
  const latest = useRef({ refresh, hold });
  useEffect(() => { latest.current = { refresh, hold }; });
  useEffect(() => {
    let away = false;
    const leave = () => { away = true; };
    const back = () => {
      if (!away || document.visibilityState === "hidden") return;
      away = false;
      if (!latest.current.hold) latest.current.refresh();
    };
    const visibility = () => (document.visibilityState === "hidden" ? leave() : back());
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", leave);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
}

type Props = { engine: WindowEngine; off: string[]; onOff: (off: string[]) => void; hello: Hello; onHello: (h: Hello) => void; onExamples?: (on: boolean) => void };

export function Models({ engine, off, onOff, hello, onHello, onExamples }: Props) {
  const { detected, error, reload, refresh } = useDetected(engine);
  const [adding, setAdding] = useState(false);
  useLookAgainOnReturn(refresh, hello === "busy" || adding);
  const [examples, setExamples] = useState<Example[] | "busy" | null>(null), [examplesError, setExamplesError] = useState<string | null>(null);
  const tryExamples = () => {
    if (examples === "busy") return;
    setExamples("busy"); setExamplesError(null);
    loadExampleTrunks((method, params) => engine.request(method, params)).then(
      (list) => { setExamples(list); onExamples?.(true); },
      (e: unknown) => { setExamples(null); setExamplesError(examplesErrorText(e)); },
    );
  };
  const rows = detected?.candidates ?? [];
  const none = Boolean(detected) && !rows.length && !detected?.configuredModel;
  // Only the model Say hello will test asks for Codex: a working model already set up keeps Say hello free (#2159 review).
  const target = detected ? helloTarget(detected, off, detected.configuredModel) : null;
  const viaCodex = target && target !== "current" && needsCodex(target) ? target : null;
  const codex = useCodexDownload(engine, codexDownloadOffered(engine) && viaCodex !== null);
  const codexWaits = Boolean(codex.view && !codex.view.ready);
  const sayHello = () => {
    if (!detected || hello === "busy") return;
    if (codexWaits) {
      if (codex.view?.action) codex.requestPrompt();
      return;
    }
    onHello("busy");
    void testModel(engine, detected, off, detected.configuredModel).then(onHello);
  };
  const ok = typeof hello === "object" && hello?.ok ? hello : null;
  const bad = typeof hello === "object" && hello && !hello.ok ? hello : null;
  const add = (label: string) => (
    <Coming need="models.authStatus" where={label}>
      <button type="button" className="r1-ob-btn r1-ob-quiet" onClick={() => setAdding(true)}><Icon name="plus" size={14} />{label}</button>
    </Coming>
  );
  return (
    <>
      <h1>Your models</h1>
      <p className="r1-ob-lede">{none ? NO_MODELS_ONBOARDING : "We found these on this computer. Untick any you don’t want Branch to use."}</p>
      {error ? <p className="r1-ob-error" role="alert">{error} <button type="button" className="r1-ob-link" data-local onClick={reload}>Try again</button></p> : null}
      {none ? <FreeModelSetup engine={engine} onReady={reload} variant="onboarding" /> : null}
      {!detected && !error ? <p className="r1-ob-hint" aria-live="polite">Looking on this computer…</p> : null}
      {rows.length ? (
        <div className="r1-ob-list">
          {rows.map((c) => (
            <div className="r1-ob-row" key={c.key}>
              <Logo id={logoId(c)} name={c.label} size={30} />
              <span className="r1-ob-grow"><b>{c.label}</b><small>{c.signedOut ? `${c.detail} · signed out` : c.detail}</small></span>
              <button type="button" role="switch" className="r1-ob-switch" data-local aria-checked={!off.includes(c.key)} aria-label={`Use ${c.label}`} onClick={() => { onOff(toggle(off, c.key)); onHello(null); }} />
            </div>
          ))}
        </div>
      ) : null}
      {codex.prompt ? (
        <p className="r1-ob-hint" role="status" data-testid="onboarding-codex-prompt">{codex.prompt}{" "}
          <Coming need={CODEX_DOWNLOAD_METHOD} where="Download Codex"><button type="button" className="r1-ob-link" data-local onClick={() => void codex.accept()}>Yes</button></Coming>
          {" · "}<button type="button" className="r1-ob-link" data-local onClick={() => void codex.decline()}>Not now</button>
        </p>
      ) : codexWaits ? (
        <p className="r1-ob-hint" role="status" data-testid="onboarding-codex">{codex.view?.line ?? codexNeededLine(viaCodex?.label || "ChatGPT")}
          {codex.view?.action ? <>{" "}<Coming need={CODEX_DOWNLOAD_METHOD} where={codex.view.action}><button type="button" className="r1-ob-link" data-local onClick={codex.requestPrompt}>{codex.view.action}</button></Coming></> : null}
        </p>
      ) : null}
      <div className="r1-ob-acts">
        {none ? add("Add one") : (
          <>
            <Coming need={["branch.setup.verify", "branch.setup.activate"]} where="Say hello">
              <button type="button" className="r1-ob-btn" disabled={!canSayHello(detected, off) || hello === "busy" || (codexWaits && !codex.view?.action)} onClick={sayHello}>{hello === "busy" ? "Saying hello…" : "Say hello"}</button>
            </Coming>
            {add("Add another")}
          </>
        )}
      </div>
      <div className="r1-ob-hello" aria-live="polite">
        {ok ? <><span className="r1-ob-dot" data-ok="true" /><span><b>{answeredBy(detected, ok.modelRef)} answered in {ok.seconds} s</b><small>{ok.modelRef}{ok.madeDefault ? " · now the default model" : ""}</small></span></> : null}
        {bad ? <><span className="r1-ob-dot" data-ok="false" /><span><b>{bad.error}</b><small><button type="button" className="r1-ob-link" data-local onClick={sayHello}>Try again</button> · <button type="button" className="r1-ob-link" data-local onClick={() => setAdding(true)}>Use another model</button></small></span></> : null}
      </div>
      {ok || Array.isArray(examples) ? null : <p className="r1-ob-none">Connecting an account makes answers smarter and faster. Or <Coming need={WAITS_FOR.examples} reason={EXAMPLES_REASON} where="Try it with examples"><button type="button" className="r1-ob-link" disabled={examples === "busy"} onClick={tryExamples}>Try it with examples</button></Coming>: look around with example Trunks, no account needed.</p>}
      {examplesError ? <p className="r1-ob-error" role="alert">{examplesError}</p> : null}
      {Array.isArray(examples) ? (
        <div className="r1-ob-examples" aria-label="Example Trunks">
          <p className="r1-ob-hint">{examplesHint(examples.length)}</p>
          {examples.length ? <div className="r1-ob-list">{examples.map((x) => <div className="r1-ob-row" key={x.id}><Icon name="spark" size={15} /><span className="r1-ob-grow"><b>{x.name}</b>{x.pitch ? <small>{x.pitch}</small> : null}</span></div>)}</div> : null}
        </div>
      ) : null}
      {/* Over the whole window (README item 48): a clear dialog, so the card it covers steps aside while it is open (onboarding.css).
          Inside the card, the body's edge fade would clip it. */}
      {adding ? createPortal(<div className="r1-ob-dlg"><SetupAddAccountDialog clear engine={engine} agentId={engine.agentId ?? ""} onClose={(added) => { setAdding(false); if (added) { onHello(null); reload(); } }} /></div>, document.body) : null}
    </>
  );
}
