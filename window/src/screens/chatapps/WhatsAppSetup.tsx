import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { requestOrComing } from "../../connect/capabilities";
import { errorText, record } from "../../places/settings/adapter";
import { WizardFrame } from "./SetupWizard";
import { Access } from "./Access";
import type { ChatApp } from "./catalogue";

type Link = { qr?: string; linked: boolean; message?: string; error?: string };
export function WhatsAppSetup({ engine, app, onClose }: { engine: WindowEngine; app: ChatApp; onClose: (changed: boolean) => void }) {
  const [link, setLink] = useState<Link>({ linked: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    const start = async () => {
      try {
        let response = record(await requestOrComing(engine, "web.login.start", { channel: "whatsapp", timeoutMs: 30000 }));
        let qr: string | undefined, sessionKey: string | undefined;
        while (live) {
          if (typeof response.qrDataUrl === "string" && /^data:image\/(png|svg\+xml|webp);/.test(response.qrDataUrl)) qr = response.qrDataUrl;
          if (typeof response.sessionKey === "string") sessionKey = response.sessionKey;
          const next = { qr, linked: response.connected === true, message: typeof response.message === "string" ? response.message : undefined };
          setLink(next);
          if (next.linked) return;
          // Avoid a tight retry loop if an engine answers an expired QR immediately.
          await new Promise<void>(resolve => { wake = resolve; timer = setTimeout(resolve, 500); });
          if (!live) return;
          response = record(await requestOrComing(engine, "web.login.wait", { channel: "whatsapp", timeoutMs: 120000, ...(qr ? { currentQrDataUrl: qr } : {}), ...(sessionKey ? { sessionKey } : {}) }));
        }
      } catch (e) { if (live) setLink(l => ({ ...l, error: errorText(e) })); }
    };
    void start();
    return () => { live = false; clearTimeout(timer); wake?.(); };
  }, [engine, attempt]);
  return <WizardFrame app={app} steps={["Link", "Save"]} active={link.linked ? 1 : 0} onClose={() => onClose(link.linked)}>
    {link.linked ? <><p>WhatsApp is linked.</p><Access engine={engine} app={app} /><button type="button" data-local="close" onClick={() => onClose(true)}>Done</button></> : <><p>Open WhatsApp on your phone → Settings → Linked devices → Link a device.</p>{link.qr ? <img className="r1-cw-qr" src={link.qr} width={220} height={220} alt="WhatsApp link code" /> : !link.error && <p role="status">Getting your link code…</p>}{link.message && <p role="status">{link.message}</p>}</>}
    {link.error && <><p role="alert">{link.error}</p><button type="button" data-need="web.login.start" onClick={() => { setLink({ linked: false }); setAttempt(a => a + 1); }}>Try again</button></>}
  </WizardFrame>;
}
