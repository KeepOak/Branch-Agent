import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { useChannelWizard } from "../../places/settings/set1/chatapps-connect";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { safeSignInUrl, type WizardStep } from "../../places/settings/account-login";
import { Dialog } from "../../shell/Dialog";
import { Access } from "./Access";
import { Pairing } from "./Pairing";
import { useChatApps } from "./useChatApps";
import type { ChatApp } from "./catalogue";
import "./wizard.css";
import botfatherQr from "./botfather.svg";
import { SLACK_MANIFEST } from "./slack-manifest";

const STEPS = ["Create", "Paste", "Check", "Pair", "Save"];
const CREATE: Record<string, { url: string; instruction: string }> = {
  telegram: { url: "https://t.me/BotFather?text=%2Fnewbot", instruction: "Open BotFather and send /newbot. Choose a name and username, then copy the bot token." },
  discord: { url: "https://discord.com/developers/applications?new_application=true", instruction: "Create an application and a bot. Turn on Message Content Intent, then copy the bot token." },
  slack: { url: `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(SLACK_MANIFEST))}`, instruction: "Create the app from Branch’s prefilled manifest, install it in your workspace, and copy the Bot User OAuth Token. Under Basic Information, create an app-level token with connections:write." },
};

/** Gateway steps drive progress. A text answer never advances to success without the engine's response. */
function stepIndex(step: WizardStep): number {
  const words = `${step.title ?? ""} ${step.message ?? ""}`.toLowerCase();
  if (/pair|allow.*message/.test(words)) return 3;
  if (/check|test|verify/.test(words) || step.executor === "gateway") return 2;
  if (/save|finish/.test(words) && step.type === "confirm") return 4;
  return 1;
}
function EngineSetup({ engine, app, onClose }: { engine: WindowEngine; app: ChatApp; onClose: (changed: boolean) => void }) {
  const wizard = useChannelWizard(engine, app.channel!);
  const live = useChatApps(engine);
  const [saved, setSaved] = useState(false);
  const [failedStage, setFailedStage] = useState(1);
  const view = wizard.view;
  const active = view.phase === "done" ? saved ? 4 : 3 : view.phase === "step" ? stepIndex(view.step) : view.phase === "error" ? failedStage : 1;
  const step = view.phase === "step" ? view.step : null;
  const [showSecret, setShowSecret] = useState(false);
  const close = () => { wizard.cancel(); onClose(view.phase === "done"); };
  const send = (value?: unknown) => { if (!wizard.busy) { setShowSecret(false); setFailedStage(view.phase === "step" && view.step.type === "text" ? 2 : active); wizard.answer(value); } };
  const tokenInvalid = app.id === "telegram" && step?.sensitive && /token/i.test(`${step.title} ${step.message}`) && typeof wizard.value === "string" && !/^\d{5,15}:[A-Za-z0-9_-]{30,64}$/.test(wizard.value.trim());
  return <WizardFrame app={app} active={active} onClose={close}>
    {view.phase === "starting" && <p role="status">Starting setup…</p>}
    {view.phase === "error" && <><p role="alert">{view.message}</p><button type="button" disabled={wizard.busy} data-need="wizard.next" onClick={wizard.retry}>Try again</button></>}
    {step && <div className="r1-cw-body" aria-live="polite">
      <h3>{step.title}</h3>{step.message && <p>{step.message}</p>}
      {safeSignInUrl(step.externalUrl) && <a href={safeSignInUrl(step.externalUrl)!} target="_blank" rel="noopener noreferrer">Open {app.name}</a>}
      {step.deviceCode && <p><code>{step.deviceCode.code}</code>{step.deviceCode.message}</p>}
      {step.type === "text" && <label>{step.title ?? "Answer"}<span className="r1-cw-input"><input type={step.sensitive && !showSecret ? "password" : "text"} aria-label={step.title ?? "Answer"} autoComplete="off" spellCheck={false} disabled={wizard.busy} value={typeof wizard.value === "string" ? wizard.value : ""} placeholder={step.placeholder} onChange={e => wizard.setValue(e.target.value)} data-local="answer" />{step.sensitive && <button type="button" data-local="visibility" aria-label={showSecret ? "Hide secret" : "Show secret"} onClick={() => setShowSecret(v => !v)}>{showSecret ? "Hide" : "Show"}</button>}</span></label>}
      {step.type === "select" && step.options?.map((o, i) => <button type="button" key={i} disabled={wizard.busy} data-need="wizard.next" onClick={() => send(o.value)}>{o.label}{o.hint && <small>{o.hint}</small>}</button>)}
      {step.type === "multiselect" && step.options?.map((o, i) => <label key={i}><input type="checkbox" disabled={wizard.busy} checked={Array.isArray(wizard.value) && wizard.value.includes(o.value)} data-local="answer" onChange={e => wizard.setValue(e.target.checked ? [...(Array.isArray(wizard.value) ? wizard.value : []), o.value] : (Array.isArray(wizard.value) ? wizard.value : []).filter(v => v !== o.value))} />{o.label}</label>)}
      {view.phase === "step" && view.waiting ? <p role="status">Waiting for {app.name}…</p> : step.type === "confirm" ? <div className="r1-cw-actions"><button type="button" disabled={wizard.busy} data-need="wizard.next" onClick={() => send(false)}>No</button><button type="button" disabled={wizard.busy} data-need="wizard.next" onClick={() => send(true)}>Yes</button></div> : step.type !== "select" && <button type="button" disabled={wizard.busy || tokenInvalid} data-need="wizard.next" onClick={() => send(step.type === "text" || step.type === "multiselect" ? wizard.value : undefined)}>{wizard.busy ? "Checking…" : "Continue"}</button>}
      {tokenInvalid && <small>Paste the complete bot token from BotFather.</small>}
    </div>}
    {view.phase === "done" && !saved && <><p>{app.name} is configured. Send it a message, then approve your request below.</p><Pairing engine={engine} snapshot={live.pairing} reload={live.reload} /><button type="button" data-local="save-step" onClick={() => setSaved(true)}>Continue to Save</button></>}
    {view.phase === "done" && saved && <><p>{app.name} setup is saved by the engine.</p><Access engine={engine} app={app} /><button type="button" data-local="close" onClick={close}>Done</button></>}
  </WizardFrame>;
}
export function WizardFrame({ app, active, onClose, children, steps = STEPS }: { app: ChatApp; active: number; onClose: () => void; children: React.ReactNode; steps?: string[] }) {
  return <div className="r1-cw"><Dialog title={`Set up ${app.name}`} onClose={onClose} testid="r1-channel-setup"><div className="r1-cw-head"><ChatLogo id={app.channel ?? app.id} name={app.name} size={40} /><span><b>{app.name}</b><small>{app.estimate}</small></span></div><ol className="r1-cw-steps" aria-label="Setup steps">{steps.map((s, i) => <li key={s} aria-current={i === active ? "step" : undefined}><em>{i + 1}</em>{s}</li>)}</ol>{children}</Dialog></div>;
}
export function SetupWizard({ engine, app, onClose }: { engine: WindowEngine; app: ChatApp; onClose: (changed: boolean) => void }) {
  const [started, setStarted] = useState(false);
  const create = CREATE[app.id];
  if (started) return <EngineSetup engine={engine} app={app} onClose={onClose} />;
  return <WizardFrame app={app} active={0} onClose={() => onClose(false)}><p>{create?.instruction}</p>{app.id === "telegram" && <img className="r1-cw-qr" src={botfatherQr} width={148} height={148} alt="Scan to open BotFather on your phone" />}{create && <a href={create.url} target="_blank" rel="noopener noreferrer">Open {app.name}</a>}<button type="button" data-local="start" onClick={() => setStarted(true)}>I have the details</button></WizardFrame>;
}
