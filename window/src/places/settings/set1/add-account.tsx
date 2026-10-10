// Add an account (DESIGN-SPEC §4.8.4): 1 which service (found on this computer, then every service the engine can
// sign in to, by kind), 2 sign in (the service's own page through the engine's wizard, or a key), 3 where it goes in
// the order. Every service and found item comes from the engine (models.authStatus capabilities, branch.setup.detect).
import { useEffect, useMemo, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Footer, WizardBody } from "../AccountLogin";
import { useWizard, type WizardStart, type WizardStep } from "../use-wizard";
import { Empty, useSaveRunner } from "../kit";
import { Logo, serviceName } from "./service";
import { providersOf, tokenLabel, type Provider } from "./accounts";

export type AddStart = { provider?: string; signIn?: boolean };
type Kind = "plan" | "key" | "local" | "custom";
/** One service tile: a provider with plan sign-ins or a key, or an engine setup option (local or your own). */
export type Service = { id: string; brand: string; name: string; kind: Kind; signedIn: number; logins: RecordValue[]; choice?: string };
type Step = { n: 1 } | { n: 2; svc: Service } | { n: 2; run: WizardStart; svc: Service } | { n: 3; svc: Service; before: string[] };

const FRESH_WORD: Record<string, string> = { ok: "Connected", static: "Connected", expiring: "Signing in again soon", expired: "Signed out", missing: "Sign-in missing" };
const KIND_LABEL: Record<Kind, string> = { plan: "Your plan", key: "A key", local: "On this computer", custom: "Your own" };
const KIND_SUB: Record<Kind, string> = { plan: "your plan", key: "a key", local: "on this computer", custom: "your own" };

/** Pasted sign-in secrets the engine's setup offers (branch.setup.detect manualProviders, e.g. Anthropic's
 *  setup-token), as plan sign-ins for a service with no browser sign-in. Keys stay under "A key". Adapted from
 *  engine/ui/src/pages/model-providers/login-providers.ts ("setup-secret" choices). */
function addSecretLogins(out: Service[], manual: RecordValue[], count: (id: string, key: boolean) => number): void {
  for (const o of manual.filter((x) => !/api-?key/i.test(text(x.id)))) {
    const brand = text(o.brandId ?? o.id);
    const login: RecordValue = { ...o, kind: "setup-secret", featured: false };
    const plan = out.find((s) => s.kind === "plan" && s.brand === brand);
    if (plan) {
      if (!plan.logins.some((l) => l.kind === "setup-secret" && l.id === login.id)) plan.logins.push(login);
      continue;
    }
    out.push({ id: `plan:${brand}`, brand, name: serviceName(brand, o.groupLabel ?? o.label), kind: "plan", signedIn: count(brand, false), logins: [login] });
  }
}

/** Every service, from the engine's provider capabilities and its setup options. */
export function servicesOf(caps: RecordValue[], providers: Provider[], detect: RecordValue | undefined): Service[] {
  const count = (id: string, key: boolean) => providers.filter((p) => p.provider === id).flatMap((p) => p.profiles).filter((a) => (a.type === "api_key") === key).length;
  const out: Service[] = [];
  for (const c of caps) {
    const id = text(c.provider);
    const logins = list(c.loginOptions).filter((o) => o.kind === "oauth" || o.kind === "device-code");
    const name = providers.find((p) => p.provider === id)?.displayName ?? text(logins[0]?.groupLabel ?? id);
    if (logins.length) out.push({ id: `plan:${id}`, brand: id, name: serviceName(id, name), kind: "plan", signedIn: count(id, false), logins });
    if (c.apiKeySupported === true) out.push({ id: `key:${id}`, brand: id, name: serviceName(id, name, true), kind: "key", signedIn: count(id, true), logins: [] });
  }
  addSecretLogins(out, list(detect?.manualProviders), count);
  for (const o of list(detect?.prepareOptions)) out.push({ id: `local:${text(o.id)}`, brand: text(o.brandId ?? o.id), name: visible(o.label), kind: "local", signedIn: 0, logins: [], choice: text(o.id) });
  for (const o of list(detect?.authOptions).filter((x) => x.kind === "custom")) out.push({ id: `custom:${text(o.id)}`, brand: text(o.brandId ?? o.id), name: visible(o.label), kind: "custom", signedIn: 0, logins: [], choice: text(o.id) });
  return out;
}

type Props = { engine: WindowEngine; start: AddStart; caps: RecordValue[]; providers: Provider[]; agent: { agentId?: string }; onClose: (added: boolean) => void };

/** Shell entry point: load account capabilities without leaving the current place. */
export function AddAccountFlow({ engine, onClose }: { engine: WindowEngine; onClose: (added: boolean) => void }) {
  const agent = engine.agentId ? { agentId: engine.agentId } : {};
  const status = useResource<RecordValue>(engine, "models.authStatus", agent);
  if (status.loading || status.error) return <Dialog title="Add an account" onClose={() => onClose(false)} testid="add-account">
    {status.error ? <><p role="alert">{status.error}</p><button type="button" className="btn" onClick={() => void status.reload()}>Try again</button></> : <p role="status">Reading your accounts…</p>}
  </Dialog>;
  return <AddAccountDialog engine={engine} start={{}} caps={list(status.data?.providerCapabilities)} providers={providersOf(status.data?.providers)} agent={agent} onClose={onClose} />;
}

export function AddAccountDialog({ engine, start, caps, providers, agent, onClose }: Props) {
  const detect = useResource<RecordValue>(engine, "branch.setup.detect", agent);
  const services = useMemo(() => servicesOf(caps, providers, detect.data), [caps, providers, detect.data]);
  const [selected, setSelected] = useState(false);
  const [step, setStep] = useState<Step>({ n: 1 });
  useEffect(() => {
    if (!start.provider || selected) return;
    const preferred = services.find((service) => service.brand === start.provider && service.kind === "plan") ?? services.find((service) => service.brand === start.provider);
    // Browser sign-in capabilities are already known; do not wait for the computer scan.
    if (!preferred || (detect.loading && (!start.signIn || preferred.kind !== "plan"))) return;
    setSelected(true);
    const login = [...preferred.logins].filter((option) => option.kind === "oauth" || option.kind === "device-code").sort((a, b) => Number(b.kind === "oauth") - Number(a.kind === "oauth") || Number(b.featured === true) - Number(a.featured === true))[0];
    setStep(start.signIn && login ? { n: 2, svc: preferred, run: { method: "models.authLogin", params: { authChoice: text(login.id), ...agent } } } : { n: 2, svc: preferred });
  }, [agent, detect.loading, selected, services, start.provider, start.signIn]);
  const [added, setAdded] = useState(false);
  const ids = providers.flatMap((p) => p.profiles.map((a) => a.profileId));
  const signedIn = () => { setAdded(true); if (step.n === 2) setStep({ n: 3, svc: step.svc, before: ids }); };
  const title = step.n === 1 ? "Add an account" : step.n === 2 && step.svc.brand === "anthropic" && step.svc.kind === "plan" ? "Sign in with Claude" : `Add a ${step.svc.name} account`;
  return (
    <Dialog title={title} wide={step.n === 1} onClose={() => onClose(added)} testid="add-account" footer={<StepFoot step={step} onBack={() => setStep({ n: 1 })} onClose={() => onClose(added)} />}>
      <div className="wiz-dots" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= step.n ? "wz" : ""} />)}</div>
      {step.n === 1 && start.provider && !selected ? <>
        <p role={detect.loading ? "status" : "alert"}>{detect.loading ? `Preparing ${serviceName(start.provider)} sign-in…` : detect.error ?? `Sign-in for ${serviceName(start.provider)} is not available.`}</p>
        {!detect.loading ? <button type="button" className="btn" onClick={() => void detect.reload()}>Try again</button> : null}
      </> : step.n === 1 ? <PickService services={services} detect={detect} engine={engine} agent={agent} onPick={(svc) => setStep({ n: 2, svc })} onUsed={() => { setAdded(true); onClose(true); }} /> : null}
      {step.n === 2 && !("run" in step) ? <SignIn engine={engine} svc={step.svc} agent={agent} onRun={(run) => setStep({ n: 2, svc: step.svc, run })} onKey={signedIn} /> : null}
      {step.n === 2 && "run" in step ? <RunWizard engine={engine} run={step.run} onDone={signedIn} onBack={() => setStep({ n: 1 })} /> : null}
      {step.n === 3 ? <Placed engine={engine} svc={step.svc} before={step.before} agent={agent} onDone={() => onClose(true)} /> : null}
    </Dialog>
  );
}

function StepFoot({ step, onBack, onClose }: { step: Step; onBack: () => void; onClose: () => void }) {
  if (step.n === 1) return <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>;
  if (step.n === 3) return <button type="button" className="btn ghost" onClick={onClose}>Done</button>;
  return <button type="button" className="btn ghost" onClick={onBack}>Back</button>;
}

type PickProps = { services: Service[]; detect: ReturnType<typeof useResource<RecordValue>>; engine: WindowEngine; agent: { agentId?: string }; onPick: (s: Service) => void; onUsed: () => void };
function PickService({ services, detect, engine, agent, onPick, onUsed }: PickProps) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Kind | "all">("all");
  const [using, setUsing] = useState<RecordValue | null>(null);
  if (using) return <RunWizard engine={engine} run={{ method: "branch.setup.activate.start", params: { kind: using.kind, modelRef: using.modelRef, ...agent } }} onDone={onUsed} onBack={() => setUsing(null)} />;
  const kinds = (["plan", "key", "local", "custom"] as Kind[]).filter((k) => services.some((s) => s.kind === k));
  const shown = services.filter((s) => (tab === "all" || s.kind === tab) && (!q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <p className="aa-lede">Which service is the new account with? {services.length} {services.length === 1 ? "service" : "services"}, and you can have several accounts with each.</p>
      <Found detect={detect} onUse={setUsing} />
      <label className="aa-search"><input className="inp" type="search" placeholder="Search services" aria-label="Search services" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="tabs" role="tablist" aria-label="Kinds of service">
        {(["all", ...kinds] as const).map((k) => <button key={k} type="button" role="tab" className="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{k === "all" ? "All" : KIND_LABEL[k]}</button>)}
      </div>
      {detect.loading && !services.length ? <p className="hint">Looking for services…</p> : null}
      {kinds.map((k) => <Group key={k} kind={k} services={shown.filter((s) => s.kind === k)} onPick={onPick} />)}
      {!shown.length && !detect.loading ? <Empty>No service matches.</Empty> : null}
    </>
  );
}

function Group({ kind, services, onPick }: { kind: Kind; services: Service[]; onPick: (s: Service) => void }) {
  if (!services.length) return null;
  return (
    <div className="aa-grp">
      <h3>{KIND_LABEL[kind]} <span>{services.length}</span></h3>
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
function Found({ detect, onUse }: { detect: ReturnType<typeof useResource<RecordValue>>; onUse: (c: RecordValue) => void }) {
  const found = list(detect.data?.candidates);
  if (!found.length) return null;
  const pill = (c: RecordValue): [string, string] => c.credentials === false ? ["warn", "Sign-in needed"] : c.recommended === true ? ["ok", "Recommended"] : c.credentials === true ? ["ok", "Ready to use"] : ["idle", "Found"];
  return (
    <div className="aa-grp">
      <h3>Found on this computer <span>{found.length}</span></h3>
      <p className="hint">Nothing is chosen, tested or installed until you press it.</p>
      <div className="provs">
        {found.map((c) => { const [tone, word] = pill(c); return (
          <div key={`${text(c.kind)}/${text(c.modelRef)}`} className="prov found-k">
            <Logo id={text(c.brandId ?? c.kind)} name={text(c.label)} size={34} />
            <b>{visible(c.label)}</b>
            <small>{visible(c.detail)}</small>
            <span className={`pill ${tone}`}><i />{word}</span>
            <button type="button" className="btn pri sm" onClick={() => onUse(c)}>Test and use</button>
          </div>
        ); })}
      </div>
    </div>
  );
}

type SignInProps = { engine: WindowEngine; svc: Service; agent: { agentId?: string }; onRun: (r: WizardStart) => void; onKey: () => void };
function SignIn({ engine, svc, agent, onRun, onKey }: SignInProps) {
  if (svc.kind === "key") return <KeyEntry engine={engine} svc={svc} agent={agent} onSaved={onKey} />;
  if (svc.kind === "local") return <Lead text={`Branch sets up ${svc.name} on this computer. It says what it will install before it does anything.`} action="Set it up" onGo={() => onRun({ method: "branch.setup.prepare.start", params: { authChoice: svc.choice, ...agent } })} />;
  if (svc.kind === "custom") return <Lead text={`Branch asks for the address and sign-in of ${svc.name}.`} action="Start" onGo={() => onRun({ method: "branch.setup.auth.start", params: { authChoice: svc.choice, ...agent } })} />;
  const [main, ...rest] = [...svc.logins].sort((a, b) => Number(b.kind === "oauth") - Number(a.kind === "oauth") || Number(b.featured === true) - Number(a.featured === true));
  const go = (o: RecordValue) => onRun({ method: "models.authLogin", params: { authChoice: text(o.id), ...agent } });
  if (main?.kind === "setup-secret") return <details><summary>Paste a token instead</summary><SecretSignIn engine={engine} svc={svc} login={main} agent={agent} onRun={onRun} /></details>;
  return (
    <>
      <div className="aa-card">
        <p>Branch opens {svc.name}’s own sign-in page in your browser. Sign in with the account you want to add, then come back here.</p>
        <button type="button" className="btn pri sm" onClick={() => go(main)}>{svc.brand === "anthropic" ? "Sign in with Claude" : "Open the sign-in page"}</button>
        {rest.filter((o) => o.kind !== "setup-secret").length ? <div className="acts">{rest.filter((o) => o.kind !== "setup-secret").map((o) => <button key={text(o.id)} type="button" className="btn sm" title={o.hint ? visible(o.hint) : undefined} onClick={() => go(o)}>{o.kind === "device-code" ? "Sign in with a code instead" : visible(o.label)}</button>)}</div> : null}
      </div>
      {rest.filter((o) => o.kind === "setup-secret").map((o) => <details key={text(o.id)}><summary>Paste a token instead</summary><SecretSignIn engine={engine} svc={svc} login={o} agent={agent} onRun={onRun} /></details>)}
      <p className="hint">Branch never sees or stores your password.</p>
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
  const start = () => {
    if (!ready) return;
    if (first) return onRun({ method: "branch.setup.activate.start", params: { kind: "api-key", authChoice: text(login.id), apiKey: token.trim(), ...agent } });
    const secret = { value: token.trim(), match: (step: WizardStep) => !step.externalUrl && /setup-token|token/i.test(`${step.title ?? ""} ${step.message ?? ""}`) };
    onRun({ method: "models.authLogin", params: { authChoice: loginChoiceRef(svc.brand, text(login.id)), ...(!claude || name.trim() ? { profileLabel: label } : {}), ...agent }, secret });
  };
  return (
    <>
      <div className="aa-card">
        <b>{claude ? "Sign in with your Claude subscription" : visible(login.label)}</b>
        {claude ? <p>Paste an existing Claude subscription token. Branch saves it as a Claude account. <a href="https://code.claude.com/docs/en/env-vars" target="_blank" rel="noreferrer">Claude’s token guide</a></p> : login.hint ? <p>{visible(login.hint)}</p> : null}
        <label className="fld"><span>Token</span><input className="inp" type="password" autoComplete="off" aria-label="Token" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} /></label>
        {first ? null : <label className="fld"><span>Call it</span><input className="inp" aria-label="Call it" placeholder={claude ? "Saved by email if blank" : label} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} /></label>}
        <div className="acts"><button type="button" className="btn pri sm" disabled={!ready} onClick={start}>Sign in</button></div>
      </div>
      <p className="hint">{first ? "This is the Trunk’s first account, so Branch also starts using it." : claude && !name.trim() ? "Saved as its own account by its email. The Trunk keeps its model." : `Saved as its own account, “${label}”. The Trunk keeps its model.`}</p>
    </>
  );
}

function Lead({ text: t, action, onGo }: { text: string; action: string; onGo: () => void }) {
  return <div className="aa-card"><p>{t}</p><button type="button" className="btn pri sm" onClick={onGo}>{action}</button></div>;
}

function KeyEntry({ engine, svc, agent, onSaved }: { engine: WindowEngine; svc: Service; agent: { agentId?: string }; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError("");
    try {
      await engine.request("models.authSetApiKey", { provider: svc.brand, apiKey: key.trim(), ...agent });
      setKey(""); onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="aa-lede">Paste the key from {svc.name}. Branch keeps it in its own key store and shows only where it came from after this.</p>
      <label className="fld"><span>Key</span><input className="inp" type="password" autoComplete="off" aria-label="Key" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && key.trim() && void save()} /></label>
      {error ? <p className="bs-error" role="alert">{visible(error)}</p> : null}
      <div className="acts"><button type="button" className="btn pri" disabled={!key.trim() || busy} onClick={() => void save()}>{busy ? "Adding…" : "Add key"}</button></div>
    </>
  );
}

function RunWizard({ engine, run, onDone, onBack }: { engine: WindowEngine; run: WizardStart; onDone: () => void; onBack: () => void }) {
  const w = useWizard(engine, run);
  const phase = w.view.phase;
  useEffect(() => { if (phase === "done") onDone(); }, [phase, onDone]);
  return (
    <>
      <WizardBody wizard={w} doneText="Signed in." />
      <div className="acts"><Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={() => { w.cancel(); onBack(); }} /></div>
    </>
  );
}

/** Step 3: the new account, and where it goes in the order (models.authOrderSet). */
function Placed({ engine, svc, before, agent, onDone }: { engine: WindowEngine; svc: Service; before: string[]; agent: { agentId?: string }; onDone: () => void }) {
  const status = useResource<RecordValue>(engine, "models.authStatus", agent);
  const save = useSaveRunner();
  const providers = providersOf(status.data?.providers);
  const p = providers.find((x) => x.provider === svc.brand);
  const fresh = p?.profiles.find((a) => !before.includes(a.profileId));
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
      <div className="prow aa-new">
        <Logo id={svc.brand} name={svc.name} size={36} />
        <span className="grow"><b>{fresh ? `${svc.name} · ${freshName ?? "New account"}` : svc.name}</b><small>{status.loading ? "Reading the new account…" : fresh ? (fresh.type === "api_key" ? "Key" : fresh.type === "token" ? "Subscription" : "Signed in") : "Set up."}</small></span>
        {fresh ? <span className={`pill ${fresh.status === "ok" || fresh.status === "static" ? "ok" : "warn"}`}><i />{FRESH_WORD[fresh.status] ?? visible(fresh.status)}</span> : null}
      </div>
      <label className="fld"><span>Call it</span><input className="inp" disabled title="Branch can’t rename an account yet." value={freshName ?? svc.name} readOnly /></label>
      <div className="fld"><span>Where it goes in the order</span>
        <span className="acts"><button type="button" className="btn sm" disabled={!fresh} onClick={() => put("first")}>First</button><button type="button" className="btn sm" disabled={!fresh} onClick={() => put("last")}>Last</button></span>
        <small className="hint">Branch uses the first one with allowance left.</small>
      </div>
    </>
  );
}
