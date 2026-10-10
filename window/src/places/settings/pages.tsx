// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { SettingsPageProps } from "./index";
import { applyTheme, readThemeChoice } from "../../theme/theme";
import type { ThemeChoice } from "../../theme/theme";
import { at, errorText, list, record, safeEntries, saveAgentFile, saveConfig, text, visible } from "./adapter";
import type { AgentFile, ConfigSnapshot, RecordValue } from "./adapter";
import { useAction, useResource } from "./hooks";
import { ComputerSettings, GatewaySettings, LocalModelSettings, UsageSettings } from "./diagnostics";
import "./settings.css";

const INTRO: Record<string, string> = {
  general: "How Branch starts and behaves on this computer.", people: "Everyone who uses Branch: on this computer, on their own devices, and your keepoak.com team. The same list as People > People in the People place.", appearance: "How Branch looks on this computer. Changes show as you pick.",
  notifications: "When Branch may interrupt you.", instructions: "Plain files every Trunk reads before it works. They work the same as in other agents, so a file written for one of them works here.", models: "Which models answer, and where they run.",
  local: "Models that run here, free and private. Branch looks at this computer first and only offers what fits.", accounts: "Your model accounts, the order Branch uses them in, which Trunks use each, and your keepoak.com account.", voice: "Talking to Branch. Voice stays on this computer unless a voice service is connected.", chatapps: "Where you can message your Trunks, and how each chat app behaves.",
  permissions: "What Trunks may do without asking you first.", computer: "The computers your Trunks may use, and the browser they work in. Which Branch you talk to is the switcher at the top of the list.", secrets: "Sign-ins Branch may fill for you. It never sees or stores the passwords.", usage: "What each account has left, what Branch spent, what it keeps.",
  gateway: "Keeps Branch running and carries interrupted work on.", self: "What Branch may change about itself, with every change reversible.", seasons: "How Branch improves memory, skills and Trunk abilities.", updates: "Branch on this computer.",
  achievements: "Private to you, never nagging.", advanced: "What's running under the hood, for when something needs a look.", developer: "For people building on Branch.",
};
function Frame({ title, page, children }: SettingsPageProps & { children: ReactNode }) { return <div className="branch-settings"><header><h1>{title}</h1><p className="bs-lede">{INTRO[page]}</p></header>{children}</div>; }
function Section({ title, children }: { title: string; children: ReactNode }) { return <section><h2>{title}</h2>{children}</section>; }
function Gap({ children }: { children: ReactNode }) { return <div className="bs-alert">{children}</div>; }
function ActionState({ action }: { action: ReturnType<typeof useAction> }) { return <span aria-live="polite">{action.error ? <span className="bs-error" role="alert">{visible(action.error)}</span> : action.message ? <span className="bs-success">{action.message}</span> : action.busy ? "Saving…" : null}</span>; }
function ResourceState({ loading, error }: { loading: boolean; error?: string }) { return loading ? <p role="status">Loading from the engine…</p> : error ? <Gap><span className="bs-error" role="alert">{visible(error)}</span></Gap> : null; }
function Facts({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (Array.isArray(value)) return value.length ? <>{value.map((item, i) => <div key={i}><Facts value={item} depth={depth + 1} /></div>)}</> : <p>None reported by the engine.</p>;
  if (!value || typeof value !== "object") return <span>{visible(value)}</span>;
  const entries = safeEntries(value);
  return entries.length ? <dl>{entries.map(([key, item]) => <div className="bs-fact" key={key}><dt>{visible(key.replace(/([a-z])([A-Z])/g, "$1 $2"))}</dt><dd>{item && typeof item === "object" ? <details open={depth === 0}><summary>Details</summary><Facts value={item} depth={depth + 1} /></details> : visible(item)}</dd></div>)}</dl> : <p>No details reported by the engine.</p>;
}
function EngineSection({ engine, method, title, params }: Pick<SettingsPageProps, "engine"> & { method: string; title: string; params?: unknown }) {
  const state = useResource<unknown>(engine, method, params);
  return <Section title={title}><ResourceState {...state} />{state.data !== undefined && <Facts value={state.data} />}<div className="bs-actions"><button disabled={state.loading} onClick={() => void state.reload()}>Refresh</button></div></Section>;
}

type Field = { key: string; label: string; note: string; kind?: "number" | "boolean"; options?: string[] };
const FIELDS: Record<string, Field[]> = {
  general: [
    { key: "agents.defaults.userTimezone", label: "Your time zone", note: "An IANA time zone, such as Europe/London. Leave inherited for the engine's own behavior." },
    { key: "messages.queue.mode", label: "When you send while it works", note: "Steer it now, wait in line, gather messages, or interrupt. The engine applies its own queue rules.", options: ["steer", "followup", "collect", "interrupt"] },
  ],
  models: [{ key: "agents.defaults.model.primary", label: "Default model", note: "Used by Trunks without their own model override. Choose a model the engine reports as available." }],
  seasons: [
    { key: "plugins.entries.memory-core.config.rings.enabled", label: "Rings tidy memory at night", note: "Run the memory engine's consolidation passes. Inherited keeps the source default.", kind: "boolean", options: ["true", "false"] },
    { key: "plugins.entries.memory-core.config.rings.frequency", label: "Rings schedule", note: "Cron cadence for the complete sweep: light, REM, then deep. Leave inherited for the engine's schedule." },
    { key: "plugins.entries.memory-core.config.rings.timezone", label: "Rings time zone", note: "An IANA time zone for the consolidation schedule." },
    { key: "plugins.entries.memory-core.config.rings.model", label: "Model that writes the diary", note: "A provider/model reference. Inherited uses the Trunk's own model." },
  ],
  advanced: [
    { key: "agents.defaults.timeoutSeconds", label: "Task timeout (seconds)", note: "Zero means no task timeout. Inherited uses the engine's default.", kind: "number" },
    { key: "agents.defaults.maxConcurrent", label: "Simultaneous tasks", note: "The engine's task concurrency setting. No Branch-specific cap.", kind: "number" },
    { key: "agents.defaults.bootstrapMaxChars", label: "Instructions loaded per file", note: "The engine's startup context budget; the full files remain intact.", kind: "number" },
    { key: "agents.defaults.thinkingDefault", label: "Thinking level", note: "The selected model must support the requested level.", options: ["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max", "ultra"] },
  ],
};
const QUEUE_LABELS: Record<string, string> = { steer: "Steer it now", followup: "Wait in line", collect: "Gather into one", interrupt: "Stop and start over", "steer-backlog": "Steer, then wait", queue: "Queue" };
function ConfigForm(props: SettingsPageProps) {
  const resource = useResource<ConfigSnapshot>(props.engine, "config.get");
  const models = useResource<RecordValue>(props.engine, "models.list");
  const action = useAction();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const fields = FIELDS[props.page] ?? [];
  const currentValue = (key: string) => key === "agents.defaults.model.primary" && typeof at(resource.data?.config, "agents.defaults.model") === "string" ? at(resource.data?.config, "agents.defaults.model") : at(resource.data?.config, key);
  const save = () => void action.run(async () => {
    if (!resource.data) throw new Error("Load the configuration before saving.");
    const changes: RecordValue = {};
    for (const field of fields) if (Object.hasOwn(draft, field.key)) {
      const raw = draft[field.key];
      if (raw === "") changes[field.key] = null;
      else if (field.kind === "number") {
        const number = Number(raw); if (!Number.isSafeInteger(number) || number < 0 || (field.key !== "agents.defaults.timeoutSeconds" && number === 0)) throw new Error(`${field.label} must be ${field.key === "agents.defaults.timeoutSeconds" ? "a non-negative" : "a positive"} whole number.`);
        changes[field.key] = number;
      } else if (field.kind === "boolean") changes[field.key] = raw === "true";
      else changes[field.key] = raw;
    }
    await saveConfig(props.engine, resource.data, changes);
    setDraft({}); await resource.reload();
  });
  const modelOptions = list(models.data?.models).filter(m => m.available !== false).map(m => ({ id: `${text(m.provider)}/${text(m.id)}`, label: visible(m.name ?? m.id) }));
  return <Section title={props.page === "models" ? "Model selection" : props.page === "advanced" ? "Engine controls" : props.page === "seasons" ? "Rings" : "Conversation & time"}>
    <ResourceState {...resource} />
    {resource.data?.valid === false && <Gap>The engine reports an invalid configuration. Saving is unavailable until its validation errors are resolved.<Facts value={resource.data.issues} /></Gap>}
    {resource.data && fields.map(field => {
      const stored = currentValue(field.key); const value = draft[field.key] ?? (stored === undefined ? "" : text(stored));
      const options = field.key === "agents.defaults.model.primary" ? modelOptions : field.options?.map(id => ({ id, label: field.kind === "boolean" ? id === "true" ? "On" : "Off" : QUEUE_LABELS[id] ?? id }));
      return <label className="bs-row" key={field.key}><span><span className="bs-label">{field.label}</span><small>{field.note}</small>{props.level === "technical" && <small>{field.key}</small>}</span>
        {options ? <select aria-label={field.label} disabled={action.busy} value={value} onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))}><option value="">Inherited from the engine</option>{value && !options.some(o => o.id === value) && <option value={value}>{value}</option>}{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        : <input aria-label={field.label} type={field.kind === "number" ? "number" : "text"} step={field.kind === "number" ? 1 : undefined} disabled={action.busy} value={value} placeholder="Inherited from the engine" onChange={e => setDraft(d => ({ ...d, [field.key]: e.target.value }))} />}</label>;
    })}
    {props.page === "models" && <><ResourceState {...models} />{!models.loading && !models.error && !modelOptions.length && <Gap>No models are available. Connect a model service in Accounts before sending a conversation.{props.openSettings && <div className="bs-actions"><button onClick={() => props.openSettings?.("accounts")}>Open Accounts</button></div>}</Gap>}</>}
    <div className="bs-actions"><button className="bs-primary" disabled={action.busy || resource.loading || !resource.data || resource.data.valid === false || !Object.keys(draft).length} onClick={save}>Save changes</button><button disabled={action.busy || resource.loading} onClick={() => { setDraft({}); void resource.reload(); }}>Reload</button><ActionState action={action} /></div>
    <small>Changes are checked and saved by the engine against the loaded revision. Inherited values keep source defaults. Some changes restart the gateway.</small>
  </Section>;
}

function Instructions(props: SettingsPageProps) {
  const agents = useResource<RecordValue>(props.engine, "agents.list");
  const [selectedAgent, setSelectedAgent] = useState(props.engine.agentId ?? "");
  const agentId = selectedAgent || text(agents.data?.defaultId === undefined ? "" : agents.data.defaultId);
  return <><Section title="Your Trunk"><ResourceState {...agents} /><label className="bs-row"><span className="bs-label">Edit instructions for</span><select aria-label="Edit instructions for" value={agentId} onChange={e => setSelectedAgent(e.target.value)}><option value="">Choose a Trunk</option>{list(agents.data?.agents).map(a => <option key={text(a.id)} value={text(a.id)}>{visible(a.name ?? a.id)}</option>)}</select></label></Section>{agentId && <AgentDocuments key={agentId} {...props} agentId={agentId} />}</>;
}
function AgentDocuments(props: SettingsPageProps & { agentId: string }) {
  const files = useResource<RecordValue>(props.engine, "agents.files.list", { agentId: props.agentId });
  const [name, setName] = useState("");
  return <Section title="Instructions & personality"><ResourceState {...files} /><div className="bs-tabs">{list(files.data?.files).map(f => <button key={text(f.name)} aria-pressed={name === f.name} onClick={() => setName(text(f.name))}>{text(f.name)}</button>)}</div>{name ? <DocumentEditor key={name} {...props} name={name} /> : <p>Choose a document to read or edit. Branch uses the engine's canonical instruction files.</p>}</Section>;
}
function DocumentEditor(props: SettingsPageProps & { agentId: string; name: string }) {
  const resource = useResource<{ file: AgentFile }>(props.engine, "agents.files.get", { agentId: props.agentId, name: props.name });
  const [draft, setDraft] = useState<string | null>(null); const action = useAction();
  const file = resource.data?.file; const content = draft ?? file?.content ?? "";
  return <><ResourceState {...resource} />{file && <>{file.missing && <p>This document does not exist yet. Saving creates it in this Trunk's workspace.</p>}<textarea aria-label={`${props.name} contents`} spellCheck={false} disabled={action.busy} value={content} onChange={e => setDraft(e.target.value)} /><div className="bs-actions"><button className="bs-primary" disabled={action.busy || draft === null || draft === (file.content ?? "")} onClick={() => void action.run(async () => { await saveAgentFile(props.engine, props.agentId, file, content); setDraft(null); await resource.reload(); })}>Save document</button><button disabled={action.busy || resource.loading} onClick={() => { setDraft(null); void resource.reload(); }}>Reload document</button><ActionState action={action} /></div><small>Saves include the engine's document revision so a changed file is not silently overwritten.</small></>}</>;
}

function Voice(props: SettingsPageProps) {
  const resource = useResource<RecordValue>(props.engine, "tts.status"); const action = useAction();
  const change = (method: string, params = {}) => void action.run(async () => { await props.engine.request(method, params); await resource.reload(); });
  return <Section title="Speaking"><ResourceState {...resource} />{resource.data && <><div className="bs-row"><span><span className="bs-label">Speak replies</span><small>Uses the engine's configured speech service and auto mode.</small></span><button disabled={action.busy} aria-pressed={resource.data.enabled === true} onClick={() => change(resource.data?.enabled ? "tts.disable" : "tts.enable")}>{resource.data.enabled ? "On · turn off" : "Off · turn on"}</button></div><label className="bs-row"><span className="bs-label">Speech service</span><select aria-label="Speech service" disabled={action.busy} value={text(resource.data.provider)} onChange={e => change("tts.setProvider", { provider: e.target.value })}>{list(resource.data.providerStates).map(p => <option value={text(p.id)} key={text(p.id)} disabled={p.configured !== true}>{visible(p.label ?? p.id)}{p.configured ? "" : " · not configured"}</option>)}</select></label><label className="bs-row"><span className="bs-label">Voice personality</span><select aria-label="Voice personality" disabled={action.busy} value={resource.data.persona == null ? "" : text(resource.data.persona)} onChange={e => change("tts.setPersona", { persona: e.target.value })}><option value="">Provider default</option>{list(resource.data.personas).map(p => <option key={text(p.id)} value={text(p.id)}>{visible(p.label ?? p.id)}</option>)}</select></label><ActionState action={action} /><small>Microphone capture and wake-word controls require a desktop voice adapter; this window currently supports the engine's speech reply settings.</small></>}<div className="bs-actions"><button disabled={resource.loading || action.busy} onClick={() => void resource.reload()}>Refresh voice settings</button></div></Section>;
}
function ChatApps(props: SettingsPageProps) {
  const resource = useResource<RecordValue>(props.engine, "channels.status", { probe: false }); const action = useAction();
  const accounts = record(resource.data?.channelAccounts);
  return <Section title="Connected chat apps"><ResourceState {...resource} />{resource.data && (Object.keys(accounts).length ? Object.entries(accounts).map(([channel, entries]) => <div key={channel}><h2>{visible(record(resource.data?.channelLabels)[channel] ?? channel)}</h2>{list(entries).map(account => <div key={text(account.accountId)}><div className="bs-row"><span><span className="bs-label">{visible(account.name ?? account.accountId)}</span><small>{account.running === true ? "Running" : "Stopped"}{account.connected === true ? " · connected" : ""}{account.lastError ? ` · ${visible(account.lastError)}` : ""}</small></span><button disabled={action.busy || account.configured === false} onClick={() => void action.run(async () => { await props.engine.request(account.running ? "channels.stop" : "channels.start", { channel, accountId: account.accountId }); await resource.reload(); }, "Chat app updated")}>{account.running ? "Stop" : "Start"}</button></div>{props.level === "technical" && <Facts value={account} />}</div>)}</div>) : <p>No configured chat app accounts were reported. Connect a chat app through the engine's setup flow.</p>)}{resource.data?.statusIssues != null && <Facts value={resource.data.statusIssues} />}<div className="bs-actions"><button disabled={resource.loading || action.busy} onClick={() => void resource.reload()}>Refresh chat apps</button><ActionState action={action} /></div></Section>;
}

function Appearance() {
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice); const [error, setError] = useState("");
  const change = (choice: ThemeChoice) => { setError(""); try { localStorage.setItem("branch.theme", choice); applyTheme(choice); setTheme(choice); } catch (e) { setError(`The appearance could not be saved: ${errorText(e)}`); } };
  useEffect(() => { const listener = () => setTheme(readThemeChoice()); const sameWindow = (event: Event) => { const choice = (event as CustomEvent<ThemeChoice>).detail; if (["system", "light", "dark"].includes(choice)) setTheme(choice); }; window.addEventListener("storage", listener); window.addEventListener("branch:theme-change", sameWindow); return () => { window.removeEventListener("storage", listener); window.removeEventListener("branch:theme-change", sameWindow); }; }, []);
  return <><Section title="Light or dark"><div className="bs-row"><span><span className="bs-label">Appearance</span><small>Saved for this Branch window on this computer.</small></span><div className="bs-tabs">{(["system", "light", "dark"] as const).map(t => <button key={t} aria-pressed={theme === t} onClick={() => change(t)}>{t === "system" ? "Follow computer" : t === "light" ? "Light" : "Dark"}</button>)}</div></div>{error && <p className="bs-error" role="alert">{error}</p>}</Section><Gap>Font, density, accent, faces and Pebble appearance controls need shared window preference consumers before they can change the app. Those controls are not yet connected.</Gap></>;
}

export function BaselineSettingsPage(props: SettingsPageProps) {
  const section = (method: string, title: string, params?: unknown) => <EngineSection engine={props.engine} method={method} title={title} params={params} />;
  let content: ReactNode;
  switch (props.page) {
    case "general": content = <><ConfigForm {...props} /><Gap>Message-box shortcuts and task display preferences need shared window adapters. They are not exposed by this connection.</Gap></>; break;
    case "people": content = section("users.list", "People in this Branch"); break;
    case "appearance": content = <Appearance />; break;
    case "notifications": content = <><Gap>This engine connection does not expose desktop notification preferences. Sounds, notification routing and quiet hours cannot be changed here yet.</Gap>{section("status", "Current engine status")}</>; break;
    case "instructions": content = <Instructions {...props} />; break;
    case "models": content = <><ConfigForm {...props} />{section("models.list", "Available models")}</>; break;
    case "local": content = <LocalModelSettings {...props} />; break;
    case "voice": content = <Voice {...props} />; break;
    case "chatapps": content = <ChatApps {...props} />; break;
    case "permissions": content = <>{section("exec.approvals.get", "Command approval policy")}<Gap>Approval decisions use the engine's own checks. Policy editing and device pairing need their dedicated setup flows; this view displays the current policy.</Gap></>; break;
    case "computer": content = <ComputerSettings {...props} />; break;
    case "secrets": content = <><Section title="Website & app sign-ins"><Gap>Password-manager autofill and saved sign-in lists have not been connected to this window yet. Model subscriptions and model service sign-ins are in Accounts.</Gap>{props.openSettings && <div className="bs-actions"><button onClick={()=>props.openSettings?.("accounts")}>Open Accounts</button></div>}</Section></>; break;
    case "usage": content = <UsageSettings {...props} />; break;
    case "gateway": content = <GatewaySettings {...props} />; break;
    case "self": content = <>{section("update.status", "Branch maintenance")}<Gap>Self-editing tasks can be requested in your conversation. This page has no separate self-maintenance preferences adapter.</Gap></>; break;
    case "seasons": content = <><ConfigForm {...props} />{section("doctor.memory.status", "Rings health", props.engine.agentId ? { agentId: props.engine.agentId } : {})}{section("doctor.memory.dreamDiary", "Rings diary", props.engine.agentId ? { agentId: props.engine.agentId } : {})}<Gap>Gardener's skill curation, Budding's ability ladder and the measured rollback loop need their additional source integrations. Rings uses the memory engine already present; those extra features are not yet connected.</Gap></>; break;
    case "updates": content = <>{section("update.status", "Updates & version")}<Gap>The desktop launcher owns app packaging and installation. Installing a window update requires its updater adapter.</Gap></>; break;
    case "achievements": content = <Gap>The engine does not provide an achievements ledger. Milestones will appear here when that source feature is integrated; no example milestones are shown as earned.</Gap>; break;
    case "advanced": content = <ConfigForm {...props} />; break;
    case "developer": content = <><Section title="Window connection"><Facts value={{ conversation: props.engine.sessionKey, trunk: props.engine.agentId, scopes: props.engine.scopes }} /></Section>{section("health", "Engine diagnostics", { probe: false })}</>; break;
    default: content = <Gap>This settings page has no implemented adapter.</Gap>;
  }
  return <Frame {...props}>{content}</Frame>;
}
