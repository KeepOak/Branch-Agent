// Step 2, Your models (preview item 37 step 1; HANDOFF R1-07). The rows are what branch.setup.detect really found.
// Say hello is a real model call (setup's testModel: branch.setup.verify, or branch.setup.activate for a new pick),
// never the preview's timed fetch. Continue waits for a hello that worked.
import { useState } from "react";
import { Icon } from "../../composer/icons";
import { Coming } from "../../glass/coming";
import type { WindowEngine } from "../../connect/engine";
import { Logo } from "../../places/settings/set1/service";
import { SetupAddAccountDialog } from "../../setup/SetupFlow";
import { logoId } from "../../setup/steps-early";
import { testModel, useDetected } from "../../setup/use-setup-engine";
import { answeredBy, canSayHello, EXAMPLES_REASON, toggle, unwired, type Hello } from "./model";

type Props = { engine: WindowEngine; off: string[]; onOff: (off: string[]) => void; hello: Hello; onHello: (h: Hello) => void };

export function Models({ engine, off, onOff, hello, onHello }: Props) {
  const { detected, error, reload } = useDetected(engine);
  const [adding, setAdding] = useState(false);
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
      {ok ? null : <p className="r1-ob-none">No model? <button type="button" className="r1-ob-link" {...unwired(EXAMPLES_REASON)}>Try it with examples</button>: look around with example Trunks and replies, no account needed.</p>}
      {adding ? <SetupAddAccountDialog engine={engine} agentId={engine.agentId ?? ""} onClose={(added) => { setAdding(false); if (added) { onHello(null); reload(); } }} /> : null}
    </>
  );
}
