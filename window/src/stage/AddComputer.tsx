// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../connect/engine";
import { Dialog } from "../shell/Dialog";
import { SIcon, type StageIconName } from "./stage-icons";
import { computersChanged } from "./computers";
import { shownWhy } from "../shell/shown-why";

type View = "choose" | "pair" | "cloud";
type Pairing = { phase: "loading" } | { phase: "error"; message: string } | { phase: "code"; code: string; qr?: string; setupId?: string; expiresAtMs?: number; done?: boolean };
type Profile = { id: string; name: string; os?: string };

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A one-time node setup code (device.pair.setupCode, node profile), then its status until that computer finishes. */
function usePairing(engine: WindowEngine, on: boolean): Pairing {
  const [state, setState] = useState<Pairing>({ phase: "loading" });
  useEffect(() => {
    if (!on) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = (setupId: string) => {
      timer = setTimeout(() => {
        engine.request("device.pair.setupStatus", { setupId }).then(
          (r) => {
            if (!live) return;
            if (rec(r).completion) setState((s) => (s.phase === "code" ? { ...s, done: true } : s));
            else watch(setupId);
          },
          (e: unknown) => live && setState({ phase: "error", message: message(e) }),
        );
      }, 2000);
    };
    engine.request("device.pair.setupCode", { bootstrapProfile: "node", includeQr: true }).then(
      (r) => {
        if (!live) return;
        const x = rec(r);
        const setupId = str(x.setupId) || undefined;
        setState({ phase: "code", code: str(x.setupCode), qr: str(x.qrDataUrl), setupId, expiresAtMs: typeof x.expiresAtMs === "number" ? x.expiresAtMs : undefined });
        if (setupId) watch(setupId);
      },
      (e: unknown) => live && setState({ phase: "error", message: message(e) }),
    );
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [engine, on]);
  return state;
}

function Choice({ icon, title, text, disabled, onPick }: { icon: StageIconName; title: string; text: string; disabled?: string; onPick?: () => void }) {
  return (
    <button type="button" className="prov-st" disabled={Boolean(disabled)} title={shownWhy(disabled)} onClick={onPick}>
      <span className="tile-st"><SIcon name={icon} small /></span>
      <b>{title}</b>
      <small>{disabled ? `${text} ${disabled}` : text}</small>
    </button>
  );
}

function PairBody({ pairing }: { pairing: Pairing }) {
  const [copied, setCopied] = useState(false);
  if (pairing.phase === "loading") return <p className="hint-st"><SIcon name="spin" small className="spin-st" /> Making a code…</p>;
  if (pairing.phase === "error") return <p className="err-st" role="alert">{pairing.message}</p>;
  const minutes = pairing.expiresAtMs ? Math.max(1, Math.round((pairing.expiresAtMs - Date.now()) / 60000)) : null;
  return (
    <>
      <p className="p0-st">On that computer, open a terminal and run:</p>
      <code className="code-st">branch node run --pair -</code>
      <p className="hint-st p0-st">When prompted, paste this setup code:</p>
      <code className="code-st">{pairing.code}</code>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void navigator.clipboard.writeText(pairing.code).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy setup code"}
      </button>
      {pairing.qr && <img src={pairing.qr} alt="QR code to pair this computer" width={180} height={180} />}
      {pairing.done ? (
        <>
          <p className="hint-st ok-st"><SIcon name="check" small /> That computer is paired. It shows in your computers.</p>
          <p className="p0-st">To keep lending this computer after logout or a restart, run this on that computer:</p>
          <code className="code-st">branch node install</code>
          <p className="hint-st">This installs a service or login item using the saved pairing. You can check it later with branch node status.</p>
        </>
      ) : (
        <p className="hint-st"><SIcon name="spin" small className="spin-st" /> Waiting for that computer. This updates by itself.</p>
      )}
      <p className="hint-st p0-st">The code works once{minutes ? ` and expires in ${minutes} minute${minutes === 1 ? "" : "s"}` : ""}.</p>
    </>
  );
}

// DECISIONS 134 and 136: KeepOak is one more cloud provider, a lasting machine that connects as a paired computer.
const KEEPOAK_FIRST = "Connect keepoak.com first";

function CloudBody({ engine, onDone }: { engine: WindowEngine; onDone: () => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState("");
  const [step, setStep] = useState<1 | 3>(1);
  const [made, setMade] = useState<{ label: string; status: string } | null>(null);
  useEffect(() => {
    let live = true;
    engine.request("environments.list", { projection: "profiles" }).then(
      (r) => live && setProfiles((Array.isArray(rec(r).profiles) ? (rec(r).profiles as unknown[]) : []).map(rec).map((p) => ({ id: str(p.id), name: str(p.providerDisplayId) || str(p.providerId) || str(p.id), os: str(rec((p.operatingSystems as unknown[] | undefined)?.[0]).label) || undefined })).filter((p) => p.id)),
      (e: unknown) => live && setError(message(e)),
    );
    return () => {
      live = false;
    };
  }, [engine]);
  const create = () => {
    setStep(3);
    setError("");
    engine.request("environments.create", { profileId: picked, idempotencyKey: crypto.randomUUID() }).then(
      (r) => {
        const x = rec(r);
        setMade({ label: str(x.label) || str(x.id), status: str(x.status) });
        onDone();
        computersChanged();
      },
      (e: unknown) => setError(message(e)),
    );
  };
  return (
    <div className="cw-st">
      <div className="cw-steps-st" aria-label="Steps">
        <span className={step === 1 ? "now" : "done"} aria-current={step === 1 ? "step" : undefined}><em>1</em>Where</span>
        <span title="Limits belong to the provider profile in settings."><em>2</em>Limits</span>
        <span className={step === 3 ? "now" : ""} aria-current={step === 3 ? "step" : undefined}><em>3</em>Check</span>
      </div>
      {step === 1 ? (
        <div className="fld-st">
          <span>Where it runs</span>
          {profiles === null && !error ? <p className="hint-st"><SIcon name="spin" small className="spin-st" /> Reading your cloud accounts…</p> : null}
          {profiles?.length === 0 ? <p className="hint-st">No cloud account is set up for computers yet. Each one is a worker profile in Branch's config, made with the provider's account and region.</p> : null}
          <div className="where-st" role="radiogroup" aria-label="Where it runs">
            {(profiles ?? []).map((p) => (
              <button key={p.id} type="button" className="prov-st" role="radio" aria-checked={picked === p.id} onClick={() => setPicked(p.id)}>
                <b>{p.name}</b>
                <small>{p.os ? `${p.id} · ${p.os}` : p.id}</small>
              </button>
            ))}
            <button type="button" className="prov-st" role="radio" aria-checked={false} disabled title={KEEPOAK_FIRST}>
              <b>KeepOak</b>
              <small>Your keepoak.com plan · {KEEPOAK_FIRST}</small>
            </button>
          </div>
          <p className="hint-st">Each account and region is set up with the provider, not in Branch. Billed by the provider while machines run, not by Branch.</p>
          <button type="button" className="btn pri" disabled={!picked} onClick={create}>Continue</button>
        </div>
      ) : (
        <div className="fld-st">
          {made ? (
            <p className="hint-st ok-st"><SIcon name="check" small /> {made.label} · {made.status === "available" ? "ready" : made.status}</p>
          ) : !error ? (
            <p className="hint-st"><SIcon name="spin" small className="spin-st" /> Starting it…</p>
          ) : null}
        </div>
      )}
      {error ? <p className="err-st" role="alert">{error}</p> : null}
    </div>
  );
}

/** "Add a computer": a new private computer, another computer with Branch (pairing), or a cloud computer. */
export function AddComputer({ engine, onClose, onAdded }: { engine: WindowEngine; onClose: () => void; onAdded: () => void }) {
  const [view, setView] = useState<View>("choose");
  const pairing = usePairing(engine, view === "pair");
  const paired = pairing.phase === "code" && pairing.done === true;
  const told = useRef(false);
  useEffect(() => {
    if (paired && !told.current) {
      told.current = true;
      onAdded();
      computersChanged();
    }
  }, [paired, onAdded]);
  const title = view === "pair" ? "Pair another computer" : view === "cloud" ? "A cloud computer" : "Add a computer";
  const back = view === "choose" ? null : <button type="button" className="btn ghost" onClick={() => setView("choose")}>Back</button>;
  return (
    <Dialog title={title} onClose={onClose} wide={view === "cloud"} testid="add-computer" footer={<>{back}<button type="button" className="btn ghost" onClick={onClose}>{view === "pair" && pairing.phase === "code" && pairing.done ? "Done" : "Cancel"}</button></>}>
      {view === "choose" ? (
        <div className="provs-st">
          <Choice icon="shield" title="A new private computer here" text="A sealed Windows box. Takes about 2 GB and a minute to set up." disabled="The engine has no provider for a private computer here yet." />
          <Choice icon="monitor" title="Another computer with Branch" text="A PC, a Mac or a Linux box. Pair it once with a code." onPick={() => setView("pair")} />
          <Choice icon="cloud" title="A cloud computer" text="A fresh machine for each conversation, thrown away when its work stops. Your own cloud account (Amazon, Hetzner and others) or KeepOak; the provider bills while machines run." onPick={() => setView("cloud")} />
        </div>
      ) : view === "pair" ? (
        <PairBody pairing={pairing} />
      ) : (
        <CloudBody engine={engine} onDone={onAdded} />
      )}
    </Dialog>
  );
}
