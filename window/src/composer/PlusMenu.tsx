// The + menu (DESIGN-SPEC §4.3.2): add material from a short list, with the rest one tap away under More….
// Rows the engine or window can't do yet are not listed at all, so every row shown either works or says why it is off.
import { useEffect, useRef, useState, type RefObject } from "react";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { Popover, moveFocus } from "./Popover";
import { Head, MenuItem, Sep, Switch } from "./ui";
import { Icon } from "./icons";
import type { Trunk } from "./useConversation";
import { shownWhy } from "../shell/shown-why";

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  trunks: Trunk[];
  trunkId: string;
  onAttach: () => void;
  onFolder: () => void;
  onPhoto: () => void;
  onInsert: (text: string) => void;
  onBackground: () => void;
  onOpen?: (target: OpenTarget) => void;
  /** This conversation was made temporary (sessions.create incognito). */
  temporary: boolean;
  /** Starts a new temporary conversation with this Trunk; absent when the window can't start one. */
  onTemporary?: () => void;
  onWhoAnswers?: (agentId: string) => void;
  /** Opens "Make a picture"; absent when no model is set up. */
  onPicture?: () => void;
  /** Records a voice note; absent while the microphone isn't turned on. */
  onVoiceNote?: () => void;
};

type Run = (fn: () => void) => () => void;
type View = "top" | "more";

export function PlusMenu(p: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("top");
  const run: Run = (fn) => () => {
    p.onClose();
    fn();
  };
  // The popover focuses its first row only on mount, so each view focuses its own first row when it opens.
  useEffect(() => {
    body.current?.querySelector<HTMLElement>("[data-mi]:not([disabled])")?.focus();
  }, [view]);
  return (
    <Popover anchor={p.anchor} onClose={p.onClose} label="Attach, mention a Trunk, skills, Temporary" className="c-plus">
      <div
        ref={body}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            moveFocus(body.current, e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {view === "top" ? <TopView p={p} run={run} onMore={() => setView("more")} /> : <MoreView p={p} run={run} onBack={() => setView("top")} />}
      </div>
    </Popover>
  );
}

function TopView({ p, run, onMore }: { p: Props; run: Run; onMore: () => void }) {
  return (
    <>
      <MenuItem icon="clip" label="Attach files" testId="plus-attach" onClick={run(p.onAttach)} />
      <MenuItem icon="folder" label="Add a folder" onClick={run(p.onFolder)} />
      <MenuItem icon="camera" label="Take a photo" testId="plus-photo" onClick={run(p.onPhoto)} />
      {p.onVoiceNote ? <MenuItem icon="mic" label="Record a voice note" testId="plus-voice-note" onClick={run(p.onVoiceNote)} /> : null}
      <MenuItem icon="at" label="Mention a Trunk" right={<kbd>@</kbd>} onClick={run(() => p.onInsert("@"))} />
      <MenuItem icon="slash" label="Use a skill" right={<kbd>/</kbd>} onClick={run(() => p.onInsert("/"))} />
      <Sep />
      <MenuItem icon="sliders" label="More…" onClick={onMore} />
    </>
  );
}

function MoreView({ p, run, onBack }: { p: Props; run: Run; onBack: () => void }) {
  // A Temporary switch needs either a conversation already made temporary or a way to start one.
  const showTemporary = p.temporary || Boolean(p.onTemporary);
  return (
    <>
      <MenuItem icon="back" label="Back" onClick={onBack} />
      <Sep />
      <MenuItem icon="target" label="Set a goal" right={<kbd>/goal</kbd>} onClick={run(() => p.onInsert("/goal "))} />
      {p.onPicture ? <MenuItem icon="image" label="Make a picture" onClick={run(p.onPicture)} /> : null}
      <MenuItem icon="bg" label="Run it in the background" testId="plus-background" right={<kbd>/bg</kbd>} onClick={run(p.onBackground)} />
      <Sep />
      <Head>This conversation</Head>
      <OffRow p={p} run={run} label="Phone call…" icon="call" off />
      <OffRow p={p} run={run} label="Join a meeting…" icon="meet" off={false} />
      <Head>Who answers here</Head>
      <TrunkRows p={p} run={run} />
      {showTemporary ? (
        <>
          <Sep />
          <SwitchRow icon="ghost" label="Temporary conversation" on={p.temporary}
            reason={p.temporary ? "This conversation is temporary." : "Starts a new temporary conversation with this Trunk."}
            onChange={p.temporary || !p.onTemporary ? undefined : run(p.onTemporary)} />
        </>
      ) : null}
    </>
  );
}

function OffRow({ p, run, label, icon, off }: { p: Props; run: Run; label: string; icon: "call" | "meet"; off: boolean }) {
  return (
    <MenuItem
      icon={icon}
      label={label}
      right={off ? "off" : undefined}
      disabled={!p.onOpen}
      reason={p.onOpen ? "Off until you turn it on in Settings › Voice." : NO_ROUTE}
      onClick={run(() => p.onOpen?.("settings/voice"))}
    />
  );
}

function TrunkRows({ p, run }: { p: Props; run: Run }) {
  return (
    <>
      {p.trunks.map((t) => (
        <MenuItem key={t.id} label={t.name} checked={t.id === p.trunkId} disabled={t.id !== p.trunkId && !p.onWhoAnswers}
          reason={t.id !== p.trunkId && !p.onWhoAnswers ? "This conversation's Trunk is fixed after its first message." : undefined}
          onClick={t.id !== p.trunkId && p.onWhoAnswers ? run(() => p.onWhoAnswers?.(t.id)) : undefined} />
      ))}
    </>
  );
}

function SwitchRow({ icon, label, reason, on, onChange }: { icon: "ghost"; label: string; reason: string; on: boolean; onChange?: () => void }) {
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
