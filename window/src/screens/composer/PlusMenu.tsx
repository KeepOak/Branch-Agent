// The + menu (HANDOFF R1-04, owner item 29; preview POPS.plusmenu): the tiles and the rows under them, with submenus
// that replace the content behind a back row, in the preview's order. The items this window can't do yet (Screenshot,
// Teach a task, Write a doc, Branch from here, Temporary chat, Check with me, Phone call, Join a meeting) are Coming
// rows in their preview places, each naming the engine call it waits for (#1049). A folded Improve my draft is drawn
// when the engine has its call, else hidden and listed as Coming.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "../../composer/icons";
import type { OpenTarget } from "../../composer/nav";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Popover } from "../../glass/Popover";
import { IMPROVE_COMING, IMPROVE_NEED } from "./Composer";

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
  /** The dock is 300 px or narrower, so Improve folds in here too (hidden, but listed, on an engine without its call). */
  tight?: boolean;
  /** Improve my draft (sessions.companion.ask); absent while there is no text to improve. */
  onImprove?: () => void;
  /** The engine Improve checks its call against; the CapabilityProvider's when absent. */
  engine?: Pick<WindowEngine, "features">;
  /** Records a voice note; absent where the browser can't record. */
  onVoiceNote?: () => void;
};

type View = "top" | "folder" | "add" | "call";

/** The engine call each Coming item waits for (HANDOFF R1-04 "Engine calls"; voicecall.* is the voice-call plugin's). */
export const PLUS_NEED = {
  screenshot: "desktop.observe",
  teach: "desktop.observe",
  office: "agents.documents.create",
  branch: "sessions.fork",
  temporary: "sessions.patch",
  checkWithMe: "sessions.patch",
  phone: "voicecall.initiate",
  meeting: "voicecall.start",
} as const;

export const PLUS_COMING = {
  screenshot: "Taking a screenshot needs the Branch app on your computer.",
  teach: "Teaching a task by showing it comes in a later update.",
  office: "Writing a doc, sheet or slides comes in a later update.",
  branch: "Branching from the end of a conversation comes in a later update. Use Branch from here on a message.",
  temporary: "Temporary chats come in a later update.",
  checkWithMe: "Check with me comes in a later update.",
  phone: "Phone calls come in a later update.",
  meeting: "Joining a meeting comes in a later update.",
} as const;

type Later = keyof typeof PLUS_NEED;

/** A Coming item: drawn greyed in its preview place with its one-line reason, naming the call it waits for. */
function LaterItem({ id, icon, label, hint, toggle }: { id: Later; icon: IconName; label: string; hint?: ReactNode; toggle?: boolean }) {
  return <Coming need={PLUS_NEED[id]} unwired reason={PLUS_COMING[id]} where={"+ menu › " + label}>
    <button type="button" className="r1c-mi" role={toggle ? "menuitemcheckbox" : "menuitem"} aria-checked={toggle ? false : undefined}>
      <span className="r1c-ico"><Icon name={icon} /></span>
      <span className="r1c-mi-t">{label}</span>
      {hint || toggle ? <span className="r1c-mi-r">{toggle ? <span className="r1c-hint">Off</span> : hint}</span> : null}
    </button>
  </Coming>;
}

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
          <Coming need={PLUS_NEED.screenshot} unwired reason={PLUS_COMING.screenshot} where="+ menu › Screenshot">
            <button type="button" className="r1c-tile" role="menuitem"><Icon name="eye" /><span>Screenshot</span></button>
          </Coming>
          <Tile icon="folder" label="Folder ›" onClick={() => setView("folder")} />
        </div>
        <div className="r1c-group">
          {p.onDictate ? <Item icon="mic" label="Dictate into the box" onClick={run(p.onDictate)} /> : null}
          {p.tight && p.onImprove ? <Coming hidden engine={p.engine} need={IMPROVE_NEED} reason={IMPROVE_COMING} where="+ menu › Improve my draft"><Item icon="spark" label="Improve my draft" onClick={run(p.onImprove)} /></Coming> : null}
          <LaterItem id="teach" icon="bolt" label="Teach a task" />
          {p.hasModel ? <Item icon="image" label="Make a picture" onClick={run(p.onPicture)} /> : null}
          <LaterItem id="office" icon="doc" label="Write a doc, sheet or slides" />
          <Item icon="target" label="Set a goal" hint={<kbd>/goal</kbd>} onClick={run(() => p.onInsert("/goal "))} />
          <Item icon="star" label="Skills & saved prompts" hint={<kbd>/</kbd>} onClick={run(() => p.onInsert("/"))} />
        </div>
        <div className="r1c-group">
          <Item icon="plus" label="Add from" sub onClick={() => setView("add")} />
          <Item icon="call" label="Call" sub onClick={() => setView("call")} />
        </div>
        <div className="r1c-group">
          <Item icon="clock" label="Run as a background job" hint={<kbd>/bg</kbd>} onClick={run(p.onBackground)} />
          <LaterItem id="branch" icon="branch" label="Branch from here" />
          <LaterItem id="temporary" icon="ghost" label="Temporary chat" toggle />
          <LaterItem id="checkWithMe" icon="help" label="Check with me" toggle />
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
        <LaterItem id="phone" icon="call" label="Phone call…" />
        <LaterItem id="meeting" icon="meet" label="Join a meeting…" />
      </>}
    </div>
  </Popover>;
}
