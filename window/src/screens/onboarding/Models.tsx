// Step 2, Your models (preview item 37 step 1; HANDOFF R1-07). The rows are what branch.setup.detect really found.
// Say hello is a real model call (setup's testModel: branch.setup.verify, or branch.setup.activate for a new pick),
// never the preview's timed fetch. Continue waits for a hello that worked, or for Try it with examples, which lists the
// example Trunks the engine carries (trunks.template.starters).
import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../composer/icons";
import { Coming } from "../../glass/coming";
import type { WindowEngine } from "../../connect/engine";
import { Logo } from "../../places/settings/set1/service";
import { SetupAddAccountDialog } from "../../setup/SetupFlow";
import { logoId } from "../../setup/steps-early";
import { testModel, useDetected } from "../../setup/use-setup-engine";
import { answeredBy, canSayHello, EXAMPLES_REASON, toggle, WAITS_FOR, type Example, type Hello } from "./model";
import { examplesErrorText, examplesHint, loadExampleTrunks } from "./try-examples";

type Props = { engine: WindowEngine; off: string[]; onOff: (off: string[]) => void; hello: Hello; onHello: (h: Hello) => void; onExamples?: (on: boolean) => void };

export function Models({ engine, off, onOff, hello, onHello, onExamples }: Props) {
  const { detected, error, reload } = useDetected(engine);
  const [adding, setAdding] = useState(false);
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
  const sayHello = () => {
    if (!detected || hello === "busy") return;
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
      <p className="r1-ob-lede">{none ? "No models on this computer yet." : "We found these on this computer. Untick any you don’t want Branch to use."}</p>
      {error ? <p className="r1-ob-error" role="alert">{error} <button type="button" className="r1-ob-link" data-local onClick={reload}>Try again</button></p> : null}
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
      <div className="r1-ob-acts">
        {none ? add("Add one") : (
          <>
            <Coming need={["branch.setup.verify", "branch.setup.activate"]} where="Say hello">
              <button type="button" className="r1-ob-btn" disabled={!canSayHello(detected, off) || hello === "busy"} onClick={sayHello}>{hello === "busy" ? "Saying hello…" : "Say hello"}</button>
            </Coming>
            {add("Add another")}
          </>
        )}
      </div>
      <div className="r1-ob-hello" aria-live="polite">
        {ok ? <><span className="r1-ob-dot" data-ok="true" /><span><b>{answeredBy(detected, ok.modelRef)} answered in {ok.seconds} s</b><small>{ok.modelRef}{ok.madeDefault ? " · now the default model" : ""}</small></span></> : null}
        {bad ? <><span className="r1-ob-dot" data-ok="false" /><span><b>{bad.error}</b><small><button type="button" className="r1-ob-link" data-local onClick={sayHello}>Try again</button> · <button type="button" className="r1-ob-link" data-local onClick={() => setAdding(true)}>Use another model</button></small></span></> : null}
      </div>
      {ok || Array.isArray(examples) ? null : <p className="r1-ob-none">No model? <Coming need={WAITS_FOR.examples} reason={EXAMPLES_REASON} where="Try it with examples"><button type="button" className="r1-ob-link" disabled={examples === "busy"} onClick={tryExamples}>Try it with examples</button></Coming>: look around with example Trunks and replies, no account needed.</p>}
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
