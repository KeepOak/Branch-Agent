import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useLayer } from "../../glass/Popover";
import { useEdgeFade } from "../../glass/useEdgeFade";
import { shortcutFor } from "../../shell/use-shortcuts";
import { Header, type HeaderProps } from "./Header";
import "../../glass/glass.css";
import "./frame.css";

class Region extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="r1-notice" role="alert">This part didn’t load · <button onClick={() => this.setState({ failed: false })}>Try again</button></p> : this.props.children; }
}
export type FrameProps = {
  sidebar: ReactNode; main: ReactNode; composer?: ReactNode; topics?: ReactNode; notice?: ReactNode;
  header: Omit<HeaderProps, "onToggleSidebar">; navigationKey?: string; onShortcut?: (action: "settings" | "nextConversation" | "palette" | "focusSearch") => void;
};
function readWide() { try { return localStorage.getItem("branch.r1.sidebar") !== "rail"; } catch { return true; } }
export function Frame({ sidebar, main, composer, topics, notice, header, navigationKey, onShortcut }: FrameProps) {
  const [wide, setWide] = useState(readWide), [drawer, setDrawer] = useState(false);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 760px)").matches);
  const scroll = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), side = useRef<HTMLElement>(null);
  const close = () => setDrawer(false);
  useLayer(drawer && narrow, close);
  useEdgeFade(scroll, content);
  useEffect(() => { const media = matchMedia("(max-width: 760px)"); const update = () => { setNarrow(media.matches); if (!media.matches) setDrawer(false); }; media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { setDrawer(false); if (scroll.current) scroll.current.scrollTop = 0; }, [navigationKey]);
  useEffect(() => {
    if (!drawer || !narrow) return;
    const opener = document.activeElement as HTMLElement | null;
    (side.current?.querySelector<HTMLElement>("button:not(:disabled),input,a") ?? side.current)?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, [drawer, narrow]);
  const toggle = () => {
    if (narrow) setDrawer(open => !open);
    else setWide(value => { try { localStorage.setItem("branch.r1.sidebar", value ? "rail" : "wide"); } catch { /* Keep the choice in this window when storage is unavailable. */ } return !value; });
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.g-popover,[aria-modal="true"]:not(.r1-sidebar)')) return;
      const action = shortcutFor(event, /Mac|iPhone|iPad/.test(navigator.platform));
      if (action === "toggleList") { event.preventDefault(); toggle(); }
      else if (action === "settings" || action === "nextConversation" || action === "palette" || action === "focusSearch") {
        if (onShortcut) {
          event.preventDefault();
          if (action === "palette" || action === "focusSearch") {
            if (narrow) setDrawer(true); else setWide(true);
            requestAnimationFrame(() => onShortcut(action));
          } else onShortcut(action);
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return <div className="r1-frame" data-wide={wide} data-drawer={drawer} data-topics={Boolean(topics)}>
    {narrow && drawer && <button className="r1-drawer-scrim" type="button" aria-label="Close sidebar" onClick={close} />}
    <aside className="r1-sidebar" ref={side} aria-label="Sidebar" role={narrow ? "dialog" : undefined} aria-modal={narrow && drawer ? true : undefined} inert={narrow && !drawer} tabIndex={-1} onKeyDown={event => {
      if (!narrow || !drawer || event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input,a,[tabindex='0']")];
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <div className="r1-side-top"><button type="button" className="g-ctl" onClick={toggle} aria-label={narrow ? "Close sidebar" : wide ? "Use sidebar rail" : "Expand sidebar"}>☰</button></div>
      <Region>{sidebar}</Region>
    </aside>
    {topics && <section className="r1-topics" aria-label="Topics"><Region>{topics}</Region></section>}
    <section className="r1-conversation" aria-label="Conversation">
      <Header {...header} onToggleSidebar={toggle} />
      <div className="r1-scroll edge-fade" ref={scroll}><div ref={content} className="r1-content"><Region>{notice && <div className="r1-notice" role="status">{notice}</div>}{main}</Region></div></div>
      {composer && <div className="r1-composer-slot"><Region>{composer}</Region></div>}
    </section>
  </div>;
}
