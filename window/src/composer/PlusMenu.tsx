// The + menu (DESIGN-SPEC §4.3.2): add material and switch this conversation's options without leaving the box.
// Rows the engine can't do yet stay listed, greyed with the reason (rule 2: never remove a feature).
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useRef, type RefObject } from "react";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { Popover, moveFocus } from "./Popover";
import { Head, MenuItem, Sep, Switch } from "./ui";
import { Icon } from "./icons";
import type { Trunk } from "./useConversation";
import { shownWhy } from "../shell/shown-why";

export const GAP = {
  folder: "Not available in this engine yet: it has no per-conversation folder grant.",
  screenshot: "Not available in this window yet: screen capture needs the desktop app.",
  temporary: "Not available in this engine yet: a conversation is temporary only when it is made (sessions.create incognito).",
  checkWithMe: "Not available in this engine yet: it has no ask-questions-first switch for a conversation.",
  whoAnswers: "Not available in this engine yet: a conversation's Trunk is fixed when it is made.",
  picture: "Connect a model first, in Settings › Models.",
  gif: "Not available in this engine yet: it has no GIF search service.",
  prompts: "Not available in this engine yet: it keeps no saved prompts.",
  office: "Not available in this engine yet: it has no document, spreadsheet or slides command.",
  drive: "Not available in this window yet: Google's file picker opens in the desktop app.",
  oneDrive: "Not available in this window yet: the OneDrive and SharePoint picker opens in the desktop app.",
  improve: "Not available in this engine yet: it can't rewrite a draft with your model without sending it.",
  voiceNote: "Off until you choose: it uses the microphone. Turn it on in Settings › Voice.",
};

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  trunks: Trunk[];
  trunkId: string;
  onAttach: () => void;
  onPhoto: () => void;
  onInsert: (text: string) => void;
  onBackground: () => void;
  onOpen?: (target: OpenTarget) => void;
  /** This conversation was made temporary (sessions.create incognito). */
  temporary: boolean;
  /** Starts a new temporary conversation with this Trunk. */
  onTemporary?: () => void;
  /** Opens "Make a picture"; absent when no model is set up. */
  onPicture?: () => void;
  /** Records a voice note; absent while the microphone isn't turned on. */
  onVoiceNote?: () => void;
};

export function PlusMenu(p: Props) {
  const body = useRef<HTMLDivElement>(null);
  const run = (fn: () => void) => () => {
    p.onClose();
    fn();
  };
  const offRow = (label: string, icon: "call" | "meet", off: boolean) => (
    <MenuItem
      icon={icon}
      label={label}
      right={off ? "off" : undefined}
      disabled={!p.onOpen}
      reason={p.onOpen ? "Off until you turn it on in Settings › Voice." : NO_ROUTE}
      onClick={run(() => p.onOpen?.("settings/voice"))}
    />
  );
  return (
    <Popover anchor={p.anchor} onClose={p.onClose} label="Attach, mention a Trunk, skills, Temporary" className="c-plus">
      <div
        ref={body}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            moveFocus(body.current, e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        <MenuItem icon="clip" label="Attach files" testId="plus-attach" onClick={run(p.onAttach)} />
        <MenuItem icon="folder" label="Add a folder" disabled reason={GAP.folder} />
        <MenuItem icon="camera" label="Take a screenshot" disabled reason={GAP.screenshot} />
        <MenuItem icon="camera" label="Take a photo" testId="plus-photo" onClick={run(p.onPhoto)} />
        <MenuItem icon="mic" label="Record a voice note" testId="plus-voice-note" disabled={!p.onVoiceNote} reason={p.onVoiceNote ? undefined : GAP.voiceNote} onClick={p.onVoiceNote ? run(p.onVoiceNote) : undefined} />
        <Sep />
        <MenuItem icon="at" label="Mention a Trunk" right={<kbd>@</kbd>} onClick={run(() => p.onInsert("@"))} />
        <MenuItem icon="slash" label="Use a skill" right={<kbd>/</kbd>} onClick={run(() => p.onInsert("/"))} />
        <Sep />
        <SwitchRow icon="ghost" label="Temporary conversation" on={p.temporary}
          reason={p.temporary ? "This conversation is temporary." : p.onTemporary ? "Starts a new temporary conversation with this Trunk." : GAP.temporary}
          onChange={p.temporary || !p.onTemporary ? undefined : run(p.onTemporary)} />
        <SwitchRow icon="help" label="Check with me" on={false} reason={GAP.checkWithMe} />
        <Sep />
        <Head>Who answers in this conversation</Head>
        {p.trunks.map((t) => (
          <MenuItem
            key={t.id}
            label={t.name}
            checked={t.id === p.trunkId}
            disabled={t.id !== p.trunkId}
            reason={t.id !== p.trunkId ? GAP.whoAnswers : undefined}
          />
        ))}
        <Sep />
        <MenuItem icon="image" label="Make a picture" disabled={!p.onPicture} reason={p.onPicture ? undefined : GAP.picture} onClick={p.onPicture ? run(p.onPicture) : undefined} />
        <MenuItem icon="gif" label="Find a GIF…" disabled reason={GAP.gif} />
        <MenuItem icon="target" label="Set a goal" right={<kbd>/goal</kbd>} onClick={run(() => p.onInsert("/goal "))} />
        <MenuItem icon="star" label="Saved prompts" right={<kbd>/</kbd>} disabled reason={GAP.prompts} />
        <Sep />
        <MenuItem icon="bg" label="Run it in the background" testId="plus-background" right={<kbd>/bg</kbd>} onClick={run(p.onBackground)} />
        <MenuItem icon="doc" label="Write a document, spreadsheet or slides" disabled reason={GAP.office} />
        <Sep />
        {offRow("Phone call…", "call", true)}
        {offRow("Join a meeting…", "meet", false)}
        <Sep />
        <MenuItem icon="folder" label="From Google Drive" disabled reason={GAP.drive} />
        <MenuItem icon="folder" label="From OneDrive or SharePoint" disabled reason={GAP.oneDrive} />
        <MenuItem icon="spark" label="Improve my draft" disabled reason={GAP.improve} />
      </div>
    </Popover>
  );
}

function SwitchRow({ icon, label, reason, on, onChange }: { icon: "ghost" | "help"; label: string; reason: string; on: boolean; onChange?: () => void }) {
  return (
    <div className="c-mi c-switchrow" title={shownWhy(reason)}>
      <span className="c-mi-ic"><Icon name={icon} size={16} /></span>
      <span className="c-mi-t">
        <span>{label}</span>
      </span>
      <Switch on={on} label={label} disabled={!onChange} reason={reason} onChange={() => onChange?.()} />
    </div>
  );
}
