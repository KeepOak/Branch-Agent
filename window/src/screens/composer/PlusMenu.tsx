// The + menu (HANDOFF R1-04, owner item 29; preview POPS.plusmenu): the tiles and the rows under them, with submenus
// that replace the content behind a back row. The items the engine can't do yet (Screenshot, Teach a task, Write a doc,
// Branch from here, Temporary chat, Check with me, Phone call, Join a meeting) left the menu for Seedbank › Coming to
// Branch (R1-15); only a folded Improve my draft is still hidden here and listed in the dev Coming report.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "../../composer/icons";
import type { OpenTarget } from "../../composer/nav";
import { Popover } from "../../glass/Popover";
import { IMPROVE_COMING, IMPROVE_NEED, Later } from "./Composer";

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  hasModel: boolean;
  voiceLive: boolean;
  onFiles: () => void;
  onPhoto: () => void;
  onFolder: () => void;
  onPicture: () => void;
  onInsert: (text: string) => void;
  onBackground: () => void;
  onOpen: (target: OpenTarget) => void;
  onCall: () => void;
  /** Dictate, folded in from the pill when the dock is 300 px or narrower. */
  onDictate?: () => void;
  /** The dock is 300 px or narrower, so Improve folds in here too (and, being Coming, is listed but not drawn). */
  tight?: boolean;
  /** Records a voice note; absent where the browser can't record. */
  onVoiceNote?: () => void;
};

type View = "top" | "folder" | "add" | "call";

function Tile({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return <button type="button" className="r1c-tile" role="menuitem" data-local="" onClick={onClick}><Icon name={icon} /><span>{label}</span></button>;
}

function Item({ icon, label, hint, onClick, sub }: { icon: IconName | ReactNode; label: string; hint?: ReactNode; onClick: () => void; sub?: boolean }) {
  return <button type="button" className="r1c-mi" role="menuitem" data-local="" aria-haspopup={sub ? "menu" : undefined} onClick={onClick}>
    <span className="r1c-ico">{typeof icon === "string" ? <Icon name={icon as IconName} /> : icon}</span>
    <span className="r1c-mi-t">{label}</span>
    {hint || sub ? <span className="r1c-mi-r">{hint}{sub ? <Icon name="chevRight" /> : null}</span> : null}
  </button>;
}

export function PlusMenu(p: Props) {
  const [view, setView] = useState<View>("top");
  const body = useRef<HTMLDivElement>(null);
  const run = (fn: () => void) => () => { p.onClose(); fn(); };
  useEffect(() => { body.current?.querySelector<HTMLElement>("button")?.focus(); }, [view]);
  const back = (title: string) => <button type="button" className="r1c-mi r1c-back" data-local="" onClick={() => setView("top")}><span className="r1c-ico"><Icon name="back" /></span><span className="r1c-mi-t">{title}</span></button>;
  return <Popover anchor={p.anchor} label="Add to the message" onClose={p.onClose} width={300} placement="above">
    <div ref={body} className="r1c-plus" role="menu" aria-label="Add to the message" onKeyDown={(e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const items = [...(body.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }}>
      {view === "top" ? <>
        <div className="r1c-tiles">
          <Tile icon="file" label="Files" onClick={run(p.onFiles)} />
          <Tile icon="camera" label="Photo" onClick={run(p.onPhoto)} />
          <Tile icon="folder" label="Folder ›" onClick={() => setView("folder")} />
        </div>
        <div className="r1c-group">
          {p.onDictate ? <Item icon="mic" label="Dictate into the box" onClick={run(p.onDictate)} /> : null}
          {p.tight ? <Later hidden need={IMPROVE_NEED} reason={IMPROVE_COMING} where="+ menu › Improve my draft" /> : null}
          {p.hasModel ? <Item icon="image" label="Make a picture" onClick={run(p.onPicture)} /> : null}
          <Item icon="target" label="Set a goal" hint={<kbd>/goal</kbd>} onClick={run(() => p.onInsert("/goal "))} />
          <Item icon="star" label="Skills & saved prompts" hint={<kbd>/</kbd>} onClick={run(() => p.onInsert("/"))} />
        </div>
        <div className="r1c-group">
          <Item icon="plus" label="Add from" sub onClick={() => setView("add")} />
          {p.voiceLive || p.onVoiceNote ? <Item icon="call" label="Call" sub onClick={() => setView("call")} /> : null}
        </div>
        <div className="r1c-group">
          <Item icon="clock" label="Run as a background job" hint={<kbd>/bg</kbd>} onClick={run(p.onBackground)} />
        </div>
      </> : view === "folder" ? <>
        {back("Add a folder")}
        <Item icon="folder" label="Choose a folder…" onClick={run(p.onFolder)} />
      </> : view === "add" ? <>
        {back("Add from")}
        <Item icon="plus" label="Connect Google Drive or OneDrive" hint={<span className="r1c-hint">in Customize</span>} onClick={run(() => p.onOpen("customize/tools"))} />
      </> : <>
        {back("Call")}
        {p.voiceLive ? <Item icon="mic" label="Voice call" hint={<span className="r1c-hint">here, hands-free</span>} onClick={run(p.onCall)} /> : null}
        {p.onVoiceNote ? <Item icon="wave" label="Record a voice note" onClick={run(p.onVoiceNote)} /> : null}
      </>}
    </div>
  </Popover>;
}
