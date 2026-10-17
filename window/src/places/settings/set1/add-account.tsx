// Add an account (DESIGN-SPEC §4.8.4): 1 which service (found on this computer, then every service the engine can
// sign in to, by kind), 2 sign in (the service's own page through the engine's wizard, or a key), 3 where it goes in
// the order. Every service and found item comes from the engine (models.authStatus capabilities, branch.setup.detect).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Footer, WizardBody } from "../AccountLogin";
import { useWizard, type WizardStart, type WizardStep } from "../use-wizard";
import { Empty, useSaveRunner } from "../kit";
import { brandOf, Logo, serviceName } from "./service";
import { providersOf, tokenLabel, type Profile, type Provider } from "./accounts";

export type AddStart = { provider?: string };
type Kind = "plan" | "key" | "local" | "custom";
/** One service tile: a provider with plan sign-ins or a key, or an engine setup option (local or your own). */
export type Service = { id: string; brand: string; name: string; kind: Kind; signedIn: number; logins: RecordValue[]; choice?: string; keySupported?: boolean; providers?: string[] };
const FEATURED = ["openai", "openrouter", "xai", "google", "anthropic"];
const KIND_RANK: Record<Kind, number> = { local: 0, custom: 1, plan: 2, key: 3 };
/** Local runtimes the engine may also advertise as login options. They belong on this computer, never under Your plan. */
const LOCAL_RUNTIME = new Set(["ollama", "lmstudio", "opencode", "llama-cpp", "vllm", "localai", "jan"]);
function isLocalRuntime(id: string): boolean {
  return LOCAL_RUNTIME.has(brandOf(id));
}
type Step = { n: 1 } | { n: 2; svc: Service } | { n: 2; run: WizardStart; svc: Service } | { n: 3; svc: Service; before: string[] };

const FRESH_WORD: Record<string, string> = { ok: "Connected", static: "Connected", expiring: "Signing in again soon", expired: "Signed out", missing: "Sign-in missing" };
const KIND_LABEL: Record<Kind, string> = { plan: "Your plan", key: "A key", local: "On this computer", custom: "Your own" };
const KIND_SUB: Record<Kind, string> = { plan: "your plan", key: "a key", local: "on this computer", custom: "your own" };

/** Pasted sign-in secrets the engine's setup offers (branch.setup.detect manualProviders, e.g. Anthropic's
 *  setup-token), as plan sign-ins for a service with no browser sign-in. Keys stay under "A key". Adapted from
 *  engine/ui/src/pages/model-providers/login-providers.ts ("setup-secret" choices). */
function addSecretLogins(out: Service[], manual: RecordValue[], count: (id: string, key: boolean) => number): void {
  for (const o of manual.filter((x) => !/api-?key/i.test(text(x.id)))) {
    const brand = brandOf(text(o.brandId ?? o.id));
    if (isLocalRuntime(brand)) continue;
    const login: RecordValue = { ...o, kind: "setup-secret", featured: false };
    const plan = out.find((s) => s.kind === "plan" && s.brand === brand);
    if (plan) {
      if (!plan.logins.some((l) => l.kind === "setup-secret" && l.id === login.id)) plan.logins.push(login);
      continue;
    }
    out.push({ id: `plan:${brand}`, brand, name: serviceName(brand, o.groupLabel ?? o.label), kind: "plan", signedIn: count(brand, false), logins: [login], keySupported: out.some((s) => s.kind === "key" && s.brand === brand) });
  }
}

function mergeKey(s: Service): string {
  return s.kind === "local" || s.kind === "custom" ? `${s.kind}:${s.choice ?? s.brand}` : `${s.kind}:${s.brand}`;
}

function putService(out: Map<string, Service>, next: Service): void {
  const key = mergeKey(next);
  const prev = out.get(key);
  if (!prev) {
    out.set(key, next);
    return;
  }
  const logins = [...prev.logins];
  for (const login of next.logins) {
    if (!logins.some((row) => row.id === login.id && row.kind === login.kind)) logins.push(login);
  }
  out.set(key, {
    ...prev,
    name: prev.name || next.name,
    logins,
    signedIn: Math.max(prev.signedIn, next.signedIn),
    keySupported: Boolean(prev.keySupported || next.keySupported || prev.kind === "key" || next.kind === "key"),
    choice: prev.choice ?? next.choice,
    providers: [...new Set([...(prev.providers ?? [prev.brand]), ...(next.providers ?? [next.brand])])],
  });
}

function dedupeByName(services: Service[]): Service[] {
  const out = new Map<string, Service>();
  for (const row of services) {
    const key = `${row.kind}:${row.name.trim().toLowerCase()}`;
    const prev = out.get(key);
    if (!prev) {
      out.set(key, row);
      continue;
    }
    const merged = new Map<string, Service>([[mergeKey(prev), prev]]);
    putService(merged, row);
    out.set(key, [...merged.values()][0] ?? row);
  }
  return [...out.values()];
}

function rankServices(a: Service, b: Service): number {
  const kind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (kind) return kind;
  const fa = FEATURED.indexOf(a.brand);
  const fb = FEATURED.indexOf(b.brand);
  return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb) || a.name.localeCompare(b.name) || a.brand.localeCompare(b.brand);
}

/** Every service, from the engine's provider capabilities and its setup options. One tile per brand; local first. */
export function servicesOf(caps: RecordValue[], providers: Provider[], detect: RecordValue | undefined): Service[] {
  const count = (id: string, key: boolean) => providers.filter((p) => brandOf(p.provider) === brandOf(id)).flatMap((p) => p.profiles).filter((a) => (a.type === "api_key") === key).length;
  const out = new Map<string, Service>();
  for (const c of caps) {
    const raw = text(c.provider);
    const brand = brandOf(raw);
    const logins = list(c.loginOptions).filter((o) => o.kind === "oauth" || o.kind === "device-code");
    const name = providers.find((p) => brandOf(p.provider) === brand)?.displayName ?? text(logins[0]?.groupLabel ?? raw);
    if (isLocalRuntime(brand)) {
      putService(out, { id: `local:${brand}`, brand, name: serviceName(brand, name), kind: "local", signedIn: 0, logins: [], choice: raw, providers: [raw] });
      continue;
    }
    if (logins.length) putService(out, { id: `plan:${brand}`, brand, name: serviceName(brand, name), kind: "plan", signedIn: count(raw, false), logins, keySupported: c.apiKeySupported === true, providers: [raw] });
    if (c.apiKeySupported === true) putService(out, { id: `key:${brand}`, brand, name: serviceName(brand, name, true), kind: "key", signedIn: count(raw, true), logins: [], keySupported: true, providers: [raw] });
  }
  const listed = [...out.values()];
  addSecretLogins(listed, list(detect?.manualProviders), count);
  const merged = new Map<string, Service>();
  for (const row of listed) putService(merged, row);
  for (const o of list(detect?.prepareOptions)) {
    const brand = brandOf(text(o.brandId ?? o.id));
    putService(merged, { id: `local:${text(o.id)}`, brand, name: serviceName(brand, o.label), kind: "local", signedIn: 0, logins: [], choice: text(o.id) });
  }
  for (const o of list(detect?.authOptions).filter((x) => x.kind === "custom")) {
    const brand = brandOf(text(o.brandId ?? o.id));
    putService(merged, { id: `custom:${text(o.id)}`, brand, name: serviceName(brand, o.label), kind: "custom", signedIn: 0, logins: [], choice: text(o.id) });
  }
  return dedupeByName([...merged.values()]).sort(rankServices);
}

/** The newly signed-in profile, even when it was saved under an aliased provider id (minimax-portal → minimax). */
export function freshAccount(providers: Provider[], brand: string, before: readonly string[]): { provider: Provider; profile: Profile } | undefined {
  const wanted = brandOf(brand);
  for (const p of providers) {
    if (brandOf(p.provider) !== wanted) continue;
    const profile = p.profiles.find((a) => !before.includes(a.profileId));
    if (profile) return { provider: p, profile };
  }
}

export function serviceMatchesProvider(svc: Service, provider: string): boolean {
  return svc.brand === provider || brandOf(svc.brand) === brandOf(provider) || Boolean(svc.providers?.some((id) => id === provider || brandOf(id) === brandOf(provider)));
}

/** What local Set it up will do, including sizes, before the wizard starts. */
export function localSetupCopy(svc: Service): string {
  const brand = brandOf(svc.brand);
  if (brand === "ollama") return "Ollama runs models on this computer, free and private. Install Ollama if it isn’t already. Branch can then pull a tools-capable model of about 9.6 GB. Nothing downloads until you agree.";
  if (brand === "llama-cpp") return "Branch installs a local model on this computer. It tells you the download size (often a few GB) and asks before it starts.";
  if (brand === "lmstudio") return "LM Studio runs models on this computer. Install LM Studio and load a model there first. Branch then connects to it. Nothing is downloaded until you choose a model in LM Studio.";
  return `Branch sets up ${svc.name} on this computer. It says what it will install, and how big it is, before it does anything.`;
}

/** clear: the R1 window's item 48 glass (README 48). The dialog is clear; its words sit on frosted pills (.g-label for a run of
 *  text, .g-frost for a card), its controls take the pill inside .g-clear, and a primary action stays solid (data-solid). */
type Props = { engine: WindowEngine; start: AddStart; caps: RecordValue[]; providers: Provider[]; agent: { agentId?: string }; onClose: (added: boolean) => void; clear?: boolean; /** False while models.authStatus has not finished, so an empty first caps list is not treated as the catalogue. */ capsReady?: boolean };
const Clear = createContext(false);
/** The class list with the item 48 pill added when the dialog is clear. */
function usePill() {
  const clear = useContext(Clear);
  return { clear, label: (cls?: string) => (clear ? [cls, "g-label"].filter(Boolean).join(" ") : cls), frost: (cls?: string) => (clear ? [cls, "g-frost"].filter(Boolean).join(" ") : cls), solid: clear ? { "data-solid": "" } : {} };
}
/** On a clear dialog, a block whose words sit on one frosted card; otherwise just its children. */
function Card({ children }: { children: ReactNode }) {
  return useContext(Clear) ? <div className="g-frost">{children}</div> : <>{children}</>;
}

/** Detect is ready to show: it answered, stalled, or failed. A stall is not a finished pin — a late answer may still replace the catalogue once while the picker is on screen. */
export function detectCatalogueReady(detect: { data?: unknown; loading: boolean; error?: string }): boolean {
  return detect.data !== undefined || Boolean(detect.error && !detect.loading);
}

export function AddAccountDialog({ engine, start, caps, providers, agent, onClose, clear, capsReady = true }: Props) {
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", agent);
  const detectReady = detectCatalogueReady(detect);
  const pin = useRef<{ data?: RecordValue; canReplace: boolean } | null>(null);
  const [step, setStep] = useState<Step>({ n: 1 });
  if (detectReady && !pin.current) pin.current = { data: detect.data, canReplace: detect.data === undefined && step.n === 1 };
  else if (pin.current?.canReplace && step.n !== 1) pin.current = { ...pin.current, canReplace: false };
  else if (pin.current?.canReplace && detect.data !== undefined && step.n === 1) pin.current = { data: detect.data, canReplace: false };
  const detectData = pin.current?.data;
  const services = useMemo(() => servicesOf(caps, providers, detectData), [caps, providers, detectData]);
  const detectView = pin.current ? { ...detect, data: pin.current.data } : detect;
  useEffect(() => {
    if (!start.provider || !detectReady) return;
    const preferred = services.find((service) => serviceMatchesProvider(service, start.provider!) && service.kind === "plan") ?? services.find((service) => serviceMatchesProvider(service, start.provider!));
    if (preferred) setStep((current) => current.n === 1 || (current.n === 2 && !("run" in current) && serviceMatchesProvider(current.svc, start.provider!) && current.svc.kind === "key" && preferred.kind === "plan") ? { n: 2, svc: preferred } : current);
  }, [detectReady, services, start.provider]);
  const [added, setAdded] = useState(false);
  const ids = providers.flatMap((p) => p.profiles.map((a) => a.profileId));
  const signedIn = () => { setAdded(true); if (step.n === 2) setStep({ n: 3, svc: step.svc, before: ids }); };
  const title = step.n === 1 ? "Add an account" : step.n === 2 && step.svc.brand === "anthropic" && step.svc.kind === "plan" ? "Sign in with Claude" : `Add a ${step.svc.name} account`;
  const waiting = !capsReady || (!detectReady && !pin.current);
  return (
    <Clear.Provider value={Boolean(clear)}><Dialog title={title} wide={step.n === 1} clear={clear} onClose={() => onClose(added)} testid="add-account" footer={<StepFoot step={step} onBack={() => setStep({ n: 1 })} onClose={() => onClose(added)} />}>
      <div className="wiz-dots" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= step.n ? "wz" : ""} />)}</div>
      {step.n === 1 ? <PickService services={services} detect={detectView} waiting={waiting} engine={engine} agent={agent} onPick={(svc) => setStep({ n: 2, svc })} onUsed={() => { setAdded(true); onClose(true); }} /> : null}
      {step.n === 2 && !("run" in step) ? <SignIn engine={engine} svc={step.svc} agent={agent} onRun={(run) => setStep({ n: 2, svc: step.svc, run })} onKey={signedIn} /> : null}
      {step.n === 2 && "run" in step ? <RunWizard engine={engine} run={step.run} onDone={signedIn} onBack={() => setStep({ n: 1 })} /> : null}
      {step.n === 3 ? <Placed engine={engine} svc={step.svc} before={step.before} agent={agent} onDone={() => onClose(true)} /> : null}
    </Dialog></Clear.Provider>
  );
}

function StepFoot({ step, onBack, onClose }: { step: Step; onBack: () => void; onClose: () => void }) {
  if (step.n === 1) return <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>;
  if (step.n === 3) return <button type="button" className="btn ghost" onClick={onClose}>Done</button>;
  return <button type="button" className="btn ghost" onClick={onBack}>Back</button>;
}

type PickProps = { services: Service[]; detect: ReturnType<typeof useResource<RecordValue>>; waiting?: boolean; engine: WindowEngine; agent: { agentId?: string }; onPick: (s: Service) => void; onUsed: () => void };
function PickService({ services, detect, waiting, engine, agent, onPick, onUsed }: PickProps) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Kind | "all">("all");
  const [using, setUsing] = useState<RecordValue | null>(null);
  const g = usePill();
  if (using) return <RunWizard engine={engine} run={{ method: "branch.setup.activate.start", params: { kind: using.kind, modelRef: using.modelRef, ...agent } }} onDone={onUsed} onBack={() => setUsing(null)} />;
  if (waiting || (detect.loading && detect.data === undefined && !detect.error)) {
    return (
      <>
        <p className={g.label("aa-lede")} data-lines={g.clear ? "" : undefined}>Which service is the new account with?</p>
        <label className="aa-search"><input className="inp" type="search" placeholder="Search services" aria-label="Search services" disabled /></label>
        <div className="aa-skel" data-testid="add-account-loading" aria-busy="true">
          <div className="aa-grp"><h3 className={g.label()}>On this computer</h3><div className="provs">{[0, 1, 2, 3].map((i) => <div key={i} className="prov skel" />)}</div></div>
          <div className="aa-grp"><h3 className={g.label()}>Your plan</h3><div className="provs">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="prov skel" />)}</div></div>
        </div>
      </>
    );
  }
  const kinds = (["local", "custom", "plan", "key"] as Kind[]).filter((k) => services.some((s) => s.kind === k));
  const shown = services.filter((s) => (tab === "all" || s.kind === tab) && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <p className={g.label("aa-lede")} data-lines={g.clear ? "" : undefined}>Which service is the new account with? {services.length} {services.length === 1 ? "service" : "services"}, and you can have several accounts with each.</p>
      {detect.error ? <p className={g.label("hint")} role="status">{detect.error}</p> : null}
      <Found detect={detect} services={services} onUse={setUsing} />
      <label className="aa-search"><input className="inp" type="search" placeholder="Search services" aria-label="Search services" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="tabs" role="tablist" aria-label="Kinds of service">
        {(["all", ...kinds] as const).map((k) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k === "all" ? "All" : KIND_LABEL[k]}</button>)}
      </div>
      {kinds.map((k) => <Group key={k} kind={k} services={shown.filter((s) => s.kind === k)} onPick={onPick} />)}
      {!shown.length ? <Card><Empty>No service matches.</Empty></Card> : null}
    </>
  );
}

function Group({ kind, services, onPick }: { kind: Kind; services: Service[]; onPick: (s: Service) => void }) {
  const g = usePill();
  if (!services.length) return null;
  return (
    <div className="aa-grp">
      <h3 className={g.label()}>{KIND_LABEL[kind]} <span>{services.length}</span></h3>
      <div className="provs">
        {services.map((s) => (
          <button key={s.id} type="button" className="prov" onClick={() => onPick(s)}>
            <Logo id={s.brand} name={s.name} size={34} />
            <b>{s.name}</b>
            <small>{s.signedIn ? `${s.signedIn} signed in` : "Not signed in"} · {KIND_SUB[kind]}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Found on this computer: the engine's detected candidates; "Test and use" runs its live test and sets it up. */
function Found({ detect, services, onUse }: { detect: ReturnType<typeof useResource<RecordValue>>; services: Service[]; onUse: (c: RecordValue) => void }) {
  const localBrands = new Set(services.filter((s) => s.kind === "local").map((s) => s.brand));
  const found = list(detect.data?.candidates).filter((c) => !localBrands.has(brandOf(text(c.brandId ?? c.kind))));
  const g = usePill();
  if (!found.length) return null;
  const pill = (c: RecordValue): [string, string] => c.credentials === false ? ["warn", "Sign-in needed"] : c.recommended === true ? ["ok", "Recommended"] : c.credentials === true ? ["ok", "Ready to use"] : ["idle", "Found"];
  return (
    <div className="aa-grp">
      <h3 className={g.label()}>Found on this computer <span>{found.length}</span></h3>
      <p className={g.label("hint")}>Nothing is chosen, tested or installed until you press it.</p>
      <div className="provs">
        {found.map((c) => { const [tone, word] = pill(c); return (
          <div key={`${text(c.kind)}/${text(c.modelRef)}`} className="prov found-k">
            <Logo id={text(c.brandId ?? c.kind)} name={text(c.label)} size={34} />
            <b className={g.label()}>{visible(c.label)}</b>
            <small className={g.label()}>{visible(c.detail)}</small>
            <span className={g.label(`pill ${tone}`)}><i />{word}</span>
            <button type="button" className="btn pri sm" {...g.solid} onClick={() => onUse(c)}>Test and use</button>
          </div>
        ); })}
      </div>
    </div>
  );
}

type SignInProps = { engine: WindowEngine; svc: Service; agent: { agentId?: string }; onRun: (r: WizardStart) => void; onKey: () => void };
function SignIn({ engine, svc, agent, onRun, onKey }: SignInProps) {
  const g = usePill();
  if (svc.kind === "key") return <KeyEntry engine={engine} svc={svc} agent={agent} onSaved={onKey} />;
  if (svc.kind === "local") return <Lead text={localSetupCopy(svc)} action="Set it up" onGo={() => onRun({ method: "branch.setup.prepare.start", params: { authChoice: svc.choice, ...agent } })} />;
  if (svc.kind === "custom") return <Lead text={`Branch asks for the address and sign-in of ${svc.name}.`} action="Start" onGo={() => onRun({ method: "branch.setup.auth.start", params: { authChoice: svc.choice, ...agent } })} />;
  const [main, ...rest] = [...svc.logins].sort((a, b) => Number(b.kind === "oauth") - Number(a.kind === "oauth") || Number(b.featured === true) - Number(a.featured === true));
  const go = (o: RecordValue) => onRun({ method: "models.authLogin", params: { authChoice: text(o.id), ...agent } });
  if (main?.kind === "setup-secret") return <details><summary className={g.label()}>Paste a token instead</summary><SecretSignIn engine={engine} svc={svc} login={main} agent={agent} onRun={onRun} /></details>;
  return (
    <>
      <div className="aa-card">
        <p className={g.label()} data-lines={g.clear ? "" : undefined}>Branch opens {svc.name}’s own sign-in page in your browser. Sign in with the account you want to add, then come back here.</p>
        <button type="button" className="btn pri sm" {...g.solid} onClick={() => go(main)}>{svc.brand === "anthropic" ? "Sign in with Claude" : "Open the sign-in page"}</button>
        {rest.filter((o) => o.kind !== "setup-secret").length ? <div className="acts">{rest.filter((o) => o.kind !== "setup-secret").map((o) => <button key={text(o.id)} type="button" className="btn sm" title={o.hint ? visible(o.hint) : undefined} onClick={() => go(o)}>{o.kind === "device-code" ? "Sign in with a code instead" : visible(o.label)}</button>)}</div> : null}
      </div>
      {rest.filter((o) => o.kind === "setup-secret").map((o) => <details key={text(o.id)}><summary className={g.label()}>Paste a token instead</summary><SecretSignIn engine={engine} svc={svc} login={o} agent={agent} onRun={onRun} /></details>)}
      {svc.keySupported ? <details><summary className={g.label()}>Paste a key instead</summary><KeyEntry engine={engine} svc={svc} agent={agent} onSaved={onKey} /></details> : null}
      <p className={g.label("hint")}>Branch never sees or stores your password.</p>
    </>
  );
}

/** The engine's name for a token account (engine/src/plugins/provider-auth-token.ts normalizeTokenProfileName). */
export function tokenProfileName(raw: string): string {
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "default";
}

/** The label a new token account is saved under (`<provider>:<label>`): what the owner typed, else "claude",
 *  with "-2", "-3"… added until it names no existing account, so a sign-in never replaces another one. */
export function freshTokenLabel(typed: string, taken: readonly string[], provider = "anthropic", fallback = "claude"): string {
  // The engine takes a label of at most 64 characters, so a long name is cut, leaving room for "-<n>".
  const base = typed.trim() ? tokenProfileName(typed).slice(0, 56).replace(/-+$/, "") || "default" : fallback;
  const used = new Set(taken.map((id) => id.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!used.has(`${provider}:${name}`)) return name;
  }
}

/** models.authLogin takes "<plugin>/<choice>" (formatProviderLoginChoiceRef); setup's detect lists the bare choice. */
export const loginChoiceRef = (brand: string, id: string) => (id.includes("/") ? id : `${brand}/${id}`);

/** A sign-in the service hands out as a token (Claude: `claude setup-token`). It is saved as its own account through
 *  the same credential-only wizard as the ChatGPT sign-in: models.authLogin with authChoice "anthropic/setup-token"
 *  and an optional profileLabel. Its "Paste Anthropic setup-token" step is answered with the pasted token. That never changes the
 *  Trunk's model. Only the Trunk's very first model account goes through setup's activation
 *  (branch.setup.activate.start), which also makes it the Trunk's model. */
function SecretSignIn({ engine, svc, login, agent, onRun }: { engine: WindowEngine; svc: Service; login: RecordValue; agent: { agentId?: string }; onRun: (r: WizardStart) => void }) {
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const status = useResource<RecordValue>(engine, "models.authStatus", agent);
  const all = providersOf(status.data?.providers);
  const first = Boolean(status.data) && all.every((p) => !p.profiles.length);
  const label = freshTokenLabel(name, all.flatMap((p) => p.profiles.map((a) => a.profileId)), svc.brand, svc.brand === "anthropic" ? "claude" : svc.brand);
  const claude = svc.brand === "anthropic";
  const ready = Boolean(token.trim()) && !status.loading;
  const g = usePill();
  const start = () => {
    if (!ready) return;
    if (first) return onRun({ method: "branch.setup.activate.start", params: { kind: "api-key", authChoice: text(login.id), apiKey: token.trim(), ...agent } });
    const secret = { value: token.trim(), match: (step: WizardStep) => !step.externalUrl && /setup-token|token/i.test(`${step.title ?? ""} ${step.message ?? ""}`) };
    onRun({ method: "models.authLogin", params: { authChoice: loginChoiceRef(svc.brand, text(login.id)), ...(!claude || name.trim() ? { profileLabel: label } : {}), ...agent }, secret });
  };
  return (
    <>
      <div className="aa-card">
        <b className={g.label()}>{claude ? "Sign in with your Claude subscription" : visible(login.label)}</b>
        {claude ? <p className={g.label()} data-lines={g.clear ? "" : undefined}>Paste an existing Claude subscription token. Branch saves it as a Claude account. <a href="https://code.claude.com/docs/en/env-vars" target="_blank" rel="noreferrer">Claude’s token guide</a></p> : login.hint ? <p className={g.label()} data-lines={g.clear ? "" : undefined}>{visible(login.hint)}</p> : null}
        <label className="fld"><span className={g.label()}>Token</span><input className="inp" type="password" autoComplete="off" aria-label="Token" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} /></label>
        {first ? null : <label className="fld"><span className={g.label()}>Call it</span><input className="inp" aria-label="Call it" placeholder={claude ? "Saved by email if blank" : label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} /></label>}
        <div className="acts"><button type="button" className="btn pri sm" {...g.solid} disabled={!ready} onClick={start}>Sign in</button></div>
      </div>
      <p className={g.label("hint")}>{first ? "This is the Trunk’s first account, so Branch also starts using it." : claude && !name.trim() ? "Saved as its own account by its email. The Trunk keeps its model." : `Saved as its own account, “${label}”. The Trunk keeps its model.`}</p>
    </>
  );
}

function Lead({ text: t, action, onGo }: { text: string; action: string; onGo: () => void }) {
  const g = usePill();
  return <div className="aa-card"><p className={g.label()} data-lines={g.clear ? "" : undefined}>{t}</p><button type="button" className="btn pri sm" {...g.solid} onClick={onGo}>{action}</button></div>;
}

function KeyEntry({ engine, svc, agent, onSaved }: { engine: WindowEngine; svc: Service; agent: { agentId?: string }; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const g = usePill();
  const save = async () => {
    setBusy(true); setError("");
    try {
      await engine.request("models.authSetApiKey", { provider: svc.providers?.[0] ?? svc.brand, apiKey: key.trim(), ...agent });
      setKey(""); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <p className={g.label("aa-lede")} data-lines={g.clear ? "" : undefined}>Paste the key from {svc.name}. Branch keeps it in its own key store and shows only where it came from after this.</p>
      <label className="fld"><span className={g.label()}>Key</span><input className="inp" type="password" autoComplete="off" aria-label="Key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key.trim() && void save()} /></label>
      {error ? <p className={g.label("bs-error")} role="alert">{visible(error)}</p> : null}
      <div className="acts"><button type="button" className="btn pri" {...g.solid} disabled={!key.trim() || busy} onClick={() => void save()}>{busy ? "Adding…" : "Add key"}</button></div>
    </>
  );
}

function RunWizard({ engine, run, onDone, onBack }: { engine: WindowEngine; run: WizardStart; onDone: () => void; onBack: () => void }) {
  const w = useWizard(engine, run);
  const { clear } = usePill();
  const phase = w.view.phase;
  useEffect(() => { if (phase === "done") onDone(); }, [phase, onDone]);
  return (
    <>
      <WizardBody wizard={w} doneText="Signed in." clear={clear} />
      <div className="acts"><Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={() => { w.cancel(); onBack(); }} clear={clear} /></div>
    </>
  );
}

/** Step 3: the new account, and where it goes in the order (models.authOrderSet). */
function Placed({ engine, svc, before, agent, onDone }: { engine: WindowEngine; svc: Service; before: string[]; agent: { agentId?: string }; onDone: () => void }) {
  const status = useResource<RecordValue>(engine, "models.authStatus", agent);
  const save = useSaveRunner();
  const g = usePill();
  const providers = providersOf(status.data?.providers);
  const found = freshAccount(providers, svc.brand, before);
  const p = found?.provider;
  const fresh = found?.profile;
  const freshName = fresh ? fresh.displayName ?? fresh.email ?? tokenLabel(fresh) : undefined;
  const order = (where: "first" | "last") => {
    if (!p || !fresh) return null;
    const stored = (p.profileOrder ?? []).filter((id) => id !== fresh.profileId && p.profiles.some((a) => a.profileId === id));
    const rest = [...stored, ...p.profiles.map((a) => a.profileId).filter((id) => id !== fresh.profileId && !stored.includes(id))];
    return where === "first" ? [fresh.profileId, ...rest] : [...rest, fresh.profileId];
  };
  const setOrder = (ids: string[]) => engine.request("models.authOrderSet", { provider: p?.authProvider ?? p?.provider, profileIds: ids, ...agent });
  // A stored order that leaves the new account out would skip it, so it joins the end until the owner moves it.
  const missing = Boolean(fresh && p?.profileOrder?.length && !p.profileOrder.includes(fresh.profileId));
  useEffect(() => { const ids = missing ? order("last") : null; if (ids) void setOrder(ids).catch(() => undefined); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  const put = (where: "first" | "last") => void save(async () => {
    const ids = order(where);
    if (!ids) return;
    await setOrder(ids);
    onDone();
  });
  return (
    <>
      <div className={g.frost("prow aa-new")}>
        <Logo id={svc.brand} name={svc.name} size={36} />
        <span className="grow"><b>{fresh ? `${svc.name} · ${freshName ?? "New account"}` : svc.name}</b><small>{status.loading ? "Reading the new account…" : fresh ? (fresh.type === "api_key" ? "Key" : fresh.type === "token" ? "Subscription" : "Signed in") : "Set up."}</small></span>
        {fresh ? <span className={`pill ${fresh.status === "ok" || fresh.status === "static" ? "ok" : "warn"}`}><i />{FRESH_WORD[fresh.status] ?? visible(fresh.status)}</span> : null}
      </div>
      <label className="fld"><span className={g.label()}>Call it</span><input className="inp" disabled title="Branch can’t rename an account yet." value={freshName ?? svc.name} readOnly /></label>
      <div className="fld"><span className={g.label()}>Where it goes in the order</span>
        <span className="acts"><button type="button" className="btn sm" disabled={!fresh} onClick={() => put("first")}>First</button><button type="button" className="btn sm" disabled={!fresh} onClick={() => put("last")}>Last</button></span>
        <small className={g.label("hint")}>Branch uses the first one with allowance left.</small>
      </div>
    </>
  );
}
