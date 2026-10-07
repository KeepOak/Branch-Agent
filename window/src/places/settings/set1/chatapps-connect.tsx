// Settings › Chat apps: connecting an app through the engine's channel-setup wizard (wizard.start flow "channels",
// then wizard.next), and every chat app the engine has. Adapted from engine/ui/src/pages/channels/wizard-controller.ts
// (start keeps the session the engine returns; a closed view cancels a running session) and lib/channels (the
// WhatsApp QR link: web.login.start, then web.login.wait until the phone has scanned it).
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Dialog } from "../../../shell/Dialog";
import { errorText, record, text, visible } from "../adapter";
import { advance, safeSignInUrl, type WizardResult, type WizardStep } from "../account-login";
import { Footer, WizardBody } from "../AccountLogin";
import { Empty } from "../kit";
import type { WizardView } from "../use-wizard";
import { ChatLogo as Logo } from "./chatapps-logo";
import { PILL_WORDS, type App, type CatalogueApp } from "./chatapps-data";

type Session = { id: string; notes: string[]; opened: Set<string>; live: boolean; done: boolean };

/** One channel-setup session, in the same shape as useWizard so WizardBody and Footer draw it. */
export function useChannelWizard(engine: WindowEngine, channel: string | null) {
  const [view, setView] = useState<WizardView>({ phase: "starting" });
  const [value, setValue] = useState<unknown>(undefined);
  const [busy, setBusy] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);
  const s = useRef<Session>({ id: "", notes: [], opened: new Set(), live: true, done: false });
  const show = (step: WizardStep, waiting: boolean) => {
    const url = safeSignInUrl(step.externalUrl);
    if (url && !s.current.opened.has(url)) { s.current.opened.add(url); window.open(url, "_blank", "noopener"); }
    setView({ phase: "step", step, waiting });
  };
  const apply = (r: WizardResult & { channels?: string[] }) => {
    if (!s.current.live) return;
    setBusy(false);
    if (!r.done && r.step) { setValue(r.step.initialValue ?? (r.step.type === "multiselect" ? [] : "")); show(r.step, false); return; }
    s.current.done = true;
    setChannels(r.channels ?? []);
    setView(r.status === "done" || (r.done && !r.error && r.status !== "cancelled" && r.status !== "error") ? { phase: "done" } : { phase: "error", message: [r.error || (r.status === "cancelled" ? "Setup was cancelled." : "Setup did not finish."), ...s.current.notes].join("\n\n") });
  };
  const fail = (e: unknown) => { if (s.current.live) { setBusy(false); setView({ phase: "error", message: errorText(e) }); } };
  const next = (answer?: { stepId: string; value?: unknown }) => { setBusy(true); advance(engine.request.bind(engine), s.current.id, answer, (st) => show(st, true), s.current.notes).then(apply, fail); };
  /** The first step comes back with wizard.start: notes and engine-run steps move on as advance() does. */
  const first = (r: WizardResult) => {
    const st = r.step;
    if (r.done || !st) return apply(r);
    if (st.type === "note") { if (st.message) s.current.notes.push(st.message); if (st.externalUrl || st.deviceCode) show(st, true); return next({ stepId: st.id }); }
    if (st.executor === "gateway") { show(st, true); return next(undefined); }
    apply(r);
  };
  useEffect(() => {
    const cur = s.current;
    cur.live = true;
    engine.request<Record<string, unknown>>("wizard.start", { flow: "channels", ...(channel ? { channel } : {}) }).then((r) => {
      cur.id = text(r.sessionId);
      if (cur.live) first(r as unknown as WizardResult);
      else if (r.done !== true) void engine.request("wizard.cancel", { sessionId: cur.id }).catch(() => undefined);
    }, fail);
    return () => { cur.live = false; if (cur.id && !cur.done) void engine.request("wizard.cancel", { sessionId: cur.id }).catch(() => undefined); };
    // One session per mount; the channel never changes while it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const answer = (v?: unknown) => { if (view.phase === "step") next(v === undefined ? { stepId: view.step.id } : { stepId: view.step.id, value: v }); };
  const cancel = () => { s.current.live = false; if (s.current.id && !s.current.done) void engine.request("wizard.cancel", { sessionId: s.current.id }).catch(() => undefined); };
  return { view, value, setValue, busy, answer, cancel, channels };
}

/** Connect <app> (or any app, with no channel): the engine's setup steps, then WhatsApp's QR link when it set one up. */
export function ConnectDialog({ engine, app, onClose }: { engine: WindowEngine; app: CatalogueApp | null; onClose: (changed: boolean) => void }) {
  const w = useChannelWizard(engine, app?.id ?? null);
  const done = w.view.phase === "done";
  const whatsapp = done && (w.channels.includes("whatsapp") || (!w.channels.length && app?.id === "whatsapp"));
  const close = () => { w.cancel(); onClose(done); };
  return (
    <Dialog title={app ? `Connect ${app.name}` : "Connect a chat app"} onClose={close} testid="chatapps-connect"
      footer={<Footer view={w.view} value={w.value} busy={w.busy} onAnswer={w.answer} onCancel={close} />}>
      {app ? <div className="ca-head"><Logo id={app.id} name={app.name} size={40} /><span className="grow"><b>{app.name}</b>{app.detail ? <small>{app.detail}</small> : null}</span></div> : null}
      <WizardBody wizard={w} doneText={app ? `${app.name} is set up.` : "The chat app is set up."} />
      {whatsapp ? <WhatsAppLink engine={engine} /> : null}
    </Dialog>
  );
}

type Link = { qr?: string; message?: string; linked?: boolean; key?: string; error?: string };
/** WhatsApp links to your phone with a QR code: web.login.start shows it, web.login.wait answers when it is scanned. */
function WhatsAppLink({ engine }: { engine: WindowEngine }) {
  const [link, setLink] = useState<Link>({});
  useEffect(() => {
    let live = true;
    const wait = async (cur: Link): Promise<void> => {
      const r = record(await engine.request("web.login.wait", { channel: "whatsapp", timeoutMs: 120000, ...(cur.qr ? { currentQrDataUrl: cur.qr } : {}), ...(cur.key ? { sessionKey: cur.key } : {}) }));
      const nextLink: Link = { ...cur, qr: typeof r.qrDataUrl === "string" ? r.qrDataUrl : cur.qr, message: r.message ? visible(r.message) : cur.message, linked: r.connected === true };
      if (live) { setLink(nextLink); if (!nextLink.linked) await wait(nextLink); }
    };
    void (async () => {
      try {
        const r = record(await engine.request("web.login.start", { channel: "whatsapp", timeoutMs: 30000 }));
        const first: Link = { qr: typeof r.qrDataUrl === "string" ? r.qrDataUrl : undefined, message: r.message ? visible(r.message) : undefined, linked: r.connected === true, key: typeof r.sessionKey === "string" ? r.sessionKey : undefined };
        if (!live) return;
        setLink(first);
        if (!first.linked) await wait(first);
      } catch (e) { if (live) setLink((l) => ({ ...l, error: errorText(e) })); }
    })();
    return () => { live = false; };
  }, [engine]);
  return (
    <div className="ca-qr" aria-live="polite">
      <b>{link.linked ? "WhatsApp is linked." : "Scan this code with WhatsApp on your phone"}</b>
      {link.message ? <p className="hint">{link.message}</p> : null}
      {link.qr && !link.linked ? <img src={link.qr} alt="WhatsApp link code" width={220} height={220} /> : null}
      {link.error ? <p className="bs-error" role="alert">{visible(link.error)}</p> : null}
    </div>
  );
}

/** Every chat app the engine has: search, then Open (connected) or Connect. */
export function AllAppsDialog({ apps, onOpen, onConnect, onClose }: { apps: (CatalogueApp & Partial<App>)[]; onOpen: (id: string) => void; onConnect: (app: CatalogueApp | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const shown = apps.filter((a) => !q.trim() || `${a.name} ${a.detail}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Dialog title={`All ${apps.length} chat apps`} wide onClose={onClose} testid="chatapps-all" footer={<><button type="button" className="btn ghost" onClick={() => onConnect(null)}>Find another app</button><button type="button" className="btn pri" onClick={onClose}>Done</button></>}>
      <label className="aa-search"><input className="inp" type="search" placeholder="Search chat apps" aria-label="Search chat apps" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="provs">
        {shown.map((a) => (
          <button key={a.id} type="button" className="prov" onClick={() => (a.on ? onOpen(a.id) : onConnect(a))}>
            <Logo id={a.id} name={a.name} size={34} />
            <b>{a.name}</b>
            <small>{a.on ? `${PILL_WORDS[a.tone ?? "idle"]} · open it` : a.detail || "Set it up"}</small>
          </button>
        ))}
      </div>
      {!shown.length ? <Empty>No chat app matches.</Empty> : null}
    </Dialog>
  );
}
