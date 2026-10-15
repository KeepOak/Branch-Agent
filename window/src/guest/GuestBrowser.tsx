// The owner's own browser pane: tabs, an address bar, and what the Trunk may do on these pages.
import { useEffect, useRef, useState } from "react";
import { READER_TEXT_SCRIPT } from "./guest-drive";
import type { GuestAccessStore } from "./guest-access";
import type { GuestEngine } from "./guest-host";
import type { GuestBridge } from "./guest-bridge";
import { useGuestPane } from "./use-guest-pane";
import { GuestAddressBar } from "./GuestAddressBar";
import { GuestAccessBar, GuestConsent, GuestNav, GuestReader, GuestTabStrip } from "./GuestChrome";
import { GuestTabView } from "./GuestTabView";
import "./guest.css";

export type GuestBrowserProps = {
  /** The gateway client. Absent in a pop-out window, which the Trunk does not drive. */
  engine?: GuestEngine;
  sessionKey?: string | null;
  trunkName?: string;
  bridge: GuestBridge | null;
  /** The address the first tab opens on. */
  startUrl?: string;
  /** The pop-out window: no Trunk controls and no pop-out button. */
  full?: boolean;
  /** False while the Trunk's browser is showing: the pane stays mounted, offscreen, so its pages keep their state. */
  visible?: boolean;
  access?: GuestAccessStore;
};

export function GuestBrowser({ engine, sessionKey = null, trunkName = "Trunk", bridge, startUrl, full = false, visible = true, access }: GuestBrowserProps) {
  const pane = useGuestPane({ startUrl, engine, sessionKey, access, bridge });
  const { tabs, active } = pane;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [reader, setReader] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const activeId = active?.id ?? null;
  const activeUrl = active?.url ?? "";
  useEffect(() => {
    if (!visible || (activeUrl && activeUrl !== "about:blank")) return;
    if (!isTextField(document.activeElement)) inputRef.current?.focus();
  }, [activeId, activeUrl, visible]);
  useEffect(() => {
    setReader(null);
  }, [activeId]);

  const toggleReader = () => {
    if (reader !== null) {
      setReader(null);
      return;
    }
    const view = pane.activeView();
    if (!view) return;
    void view.executeJavaScript(READER_TEXT_SCRIPT).then(
      (text) => setReader(typeof text === "string" && text.trim() ? text : "Nothing to read on this page."),
      () => setReader("The page's text couldn't be read."),
    );
  };
  const openWindow = () => {
    if (!bridge || !active?.url) return;
    bridge.openPopout(active.url).catch(() => setNotice("The window didn't open."));
  };
  const consentOwner = sessionKey ? pane.access : null;

  return (
    <section className="guest-pane" aria-label="Your browser" data-visible={visible ? "true" : "false"}>
      <div className="guest-bar">
        <GuestNav
          canBack={active?.canGoBack ?? false}
          canForward={active?.canGoForward ?? false}
          disabled={!active}
          onBack={pane.back}
          onForward={pane.forward}
          onReload={pane.reload}
        />
        <GuestAddressBar url={activeUrl} inputRef={inputRef} onSubmit={pane.go} />
        <button type="button" className="btn ghost sm" aria-pressed={reader !== null} disabled={!active} onClick={toggleReader}>Reader</button>
        {full ? null : (
          <button type="button" className="btn ghost sm" data-keep-draft="" disabled={!bridge || !active} onClick={openWindow}>Open in a window</button>
        )}
      </div>
      <GuestTabStrip tabs={tabs.tabs} activeId={tabs.activeId} onActivate={pane.activate} onClose={pane.closeTab} onNew={() => pane.openTab("")} />
      {sessionKey && consentOwner ? (
        <GuestAccessBar
          state={pane.state}
          trunkName={trunkName}
          onTakeOver={() => consentOwner.takeOver(sessionKey)}
          onHandBack={() => consentOwner.handBack(sessionKey)}
        />
      ) : null}
      <div className="guest-stage">
        {tabs.tabs.map((tab) => (
          <GuestTabView key={tab.id} tab={tab} active={tab.id === tabs.activeId} register={pane.register} onReport={pane.report} onPopup={pane.popup} />
        ))}
        {tabs.tabs.length === 0 ? <p className="guest-empty">No page is open. Type an address above or press + to open one.</p> : null}
        {reader !== null ? <GuestReader text={reader} onClose={() => setReader(null)} /> : null}
      </div>
      {notice ? <p className="stage-error-st" role="alert">{notice}</p> : null}
      {sessionKey && consentOwner && pane.state.asking ? (
        <GuestConsent onAllow={() => consentOwner.allow(sessionKey)} onNotNow={() => consentOwner.dismiss(sessionKey)} />
      ) : null}
    </section>
  );
}

function isTextField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
}
