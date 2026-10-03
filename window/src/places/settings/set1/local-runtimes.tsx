// On this computer › Runtimes (§4.7.7): each runtime with its note; "Found" when the engine detected it (a
// branch.setup.detect candidate or a local model of it), else "Look for it", which runs detection again and reports in
// place. At Advanced, "Share with your other computers" under a found Ollama is the Ollama plugin's node-inference
// switch. A runtime the engine reports as inside WSL and unreachable asks before changing WSL's networking.
import { useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Dialog } from "../../../shell/Dialog";
import { Btn, Ctl, Pill, Prow, Sec, Switch, useConfig, useLevel } from "../kit";
import { Logo } from "./service";
import type { Hw } from "./local";

type Runtime = { id: string; name: string; mark: string; note: string; off?: string };
const NO_PROBE = "Branch can’t look for this runtime yet. Add it in Accounts as your own service.";
export const RUNTIMES: Runtime[] = [
  { id: "ollama", mark: "OL", name: "Ollama", note: "Runs on this computer, so nothing leaves it and nothing is charged. Install Ollama and run `ollama serve`. No key needed." },
  { id: "lmstudio", mark: "LS", name: "LM Studio", note: "Runs on this computer. Load a model in LM Studio and start its server. Any placeholder key works." },
  { id: "vllm", mark: "VL", name: "vLLM", note: "Runs on this computer. Start vLLM with its OpenAI-compatible server. Any placeholder key works." },
  { id: "llama-cpp", mark: "LC", name: "llama.cpp", note: "Runs on this computer. Start llama-server from llama.cpp. Any placeholder key works." },
  { id: "localai", mark: "LO", name: "LocalAI", note: "Runs on this computer and can also make speech and pictures. Any placeholder key works.", off: NO_PROBE },
  { id: "jan", mark: "JA", name: "Jan", note: "Runs on this computer. Turn on Jan’s local server. Any placeholder key works.", off: NO_PROBE },
  { id: "litellm", mark: "LI", name: "LiteLLM proxy", note: "A proxy you run yourself that speaks OpenAI’s shape and forwards to whichever service you configured behind it. Point this at wherever you run it." },
];
const NOT_FOUND = "Not found on this computer. Branch can use it as soon as it runs.";
const SHARE = "plugins.entries.ollama.config.nodeInference.enabled";

type Res = ReturnType<typeof useResource<RecordValue>>;
type Props = { engine: WindowEngine; hw: Hw; detect: Res; models: Res; found: Set<string> };

/** The engine's reason a runtime can't be used, when it gave one (unavailableCandidates). */
function reasonFor(r: Runtime, detect: RecordValue | undefined): string | undefined {
  const hit = list(detect?.unavailableCandidates).find((c) => text(c.brandId) === r.id || text(c.id).startsWith(r.id));
  return hit ? visible(hit.reason) : undefined;
}

export function Runtimes({ engine, hw, detect, models, found }: Props) {
  const lv = useLevel();
  const [looked, setLooked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [wsl, setWsl] = useState(false);
  const look = async (r: Runtime) => {
    setBusy(r.id);
    await Promise.all([detect.reload(), models.reload()]);
    setBusy(null);
    setLooked((s) => new Set(s).add(r.id));
  };
  const lookFor = (r: Runtime) => {
    if (hw.windows && /\bWSL\b/.test(reasonFor(r, detect.data) ?? "")) setWsl(true);
    else void look(r);
  };
  return (
    <Sec title="Runtimes">
      <div className="rows rt-k">
        {RUNTIMES.map((r) => {
          const on = found.has(r.id);
          return [
            <Prow key={r.id} icon={<Logo id={r.id} name={r.mark} size={30} />} title={r.name} sub={!on && looked.has(r.id) ? reasonFor(r, detect.data) ?? NOT_FOUND : r.note}>
              <RuntimeRight r={r} on={on} loading={detect.loading && busy !== r.id} busy={busy === r.id} looked={looked.has(r.id)} onLook={() => lookFor(r)} />
            </Prow>,
            on && r.id === "ollama" && lv >= 1 ? <ShareRow key="share" engine={engine} /> : null,
          ];
        })}
      </div>
      {wsl ? <WslDialog onClose={() => setWsl(false)} /> : null}
    </Sec>
  );
}

type RightProps = { r: Runtime; on: boolean; loading: boolean; busy: boolean; looked: boolean; onLook: () => void };
function RuntimeRight({ r, on, loading, busy, looked, onLook }: RightProps) {
  if (on) return <Pill tone="ok">Found</Pill>;
  if (loading) return <Pill tone="idle">Looking…</Pill>;
  if (r.off) return <Btn ghost sm disabled title={r.off}>Look for it</Btn>;
  if (busy) return <Btn ghost sm disabled>Looking…</Btn>;
  return <>{looked ? <Pill tone="idle">Not found</Pill> : null}<Btn ghost sm onClick={onLook}>{looked ? "Look again" : "Look for it"}</Btn></>;
}

/** Ollama's node-inference switch: when off, this computer stops offering its Ollama models to your other computers. */
function ShareRow({ engine }: { engine: WindowEngine }) {
  const cfg = useConfig(engine);
  const on = cfg.get(SHARE) !== false;
  return (
    <div className="under-k">
      <Ctl title="Share with your other computers" sub="Their Trunks use this computer’s models. It uses this computer’s graphics card.">
        <Switch checked={on} label="Share with your other computers" disabled={cfg.loading} onChange={(v) => void cfg.set(SHARE, v)} />
      </Ctl>
    </div>
  );
}

/** Change WSL networking? (§4.7.7 parity add): the engine can't change WSL's networking, so the change is greyed. */
function WslDialog({ onClose }: { onClose: () => void }) {
  const lv = useLevel();
  const why = "Branch can’t change WSL’s networking yet.";
  return (
    <Dialog title="Change WSL networking?" onClose={onClose} footer={<><Btn ghost onClick={onClose}>Not now</Btn><Btn pri disabled title={why}>Change and restart WSL</Btn></>}>
      <p className="lead-k">Models running in WSL can’t be reached from Windows with its current networking. Branch can change one WSL networking setting for your Windows account and restart WSL once. Anything running in WSL stops.</p>
      {lv >= 2 ? <p className="hint">Settings file: <code>%USERPROFILE%\.wslconfig</code></p> : null}
      <p className="hint">{why}</p>
    </Dialog>
  );
}
