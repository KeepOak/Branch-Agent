import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Pebble } from "../face/Pebble";
import { STATE_LABEL, type AgentState } from "../face/agentState";
import { useTrunkAppearance } from "../face/appearance";
import { Icon } from "./icons";
import { syncTitleBar } from "../connect/title-bar";
import { CONVERSATION_MORE_IDLE_LABEL, conversationMoreLabel } from "./conversation-more";

export type FaceState = AgentState;

export type HeaderInfo = {
  name: string;
  trunkName: string;
  state: FaceState;
  paused?: boolean;
  isDefaultTrunk: boolean;
  /** What the Trunk is for (its identity theme), the words before "· ready" (the preview's c.role). */
  role?: string;
  renaming: boolean;
  onRename: (name: string | null) => void;
  /** Opens the Trunk's profile (§4.2.1: the header character and name open it). */
  onProfile?: () => void;
  /** A room (rooms/): two member characters stacked, and "<description> · <rule>" as the state line (§4.2.4). */
  room?: { faces: (size: number) => ReactNode; line: string } | null;
  /** The conversation's own colour (sessions.patch color), drawn as the header's tint line (§4.2.1). */
  colour?: string | null;
};

type Props = {
  /** The 34 px bar (≤760 px or focus mode): no mark or name, as in the preview; the header moves into the main column. */
  compact: boolean;
  machine: ReactNode;
  header: HeaderInfo | null;
  dark: boolean;
  listHidden: boolean;
  onToggleList: () => void;
  onBack?: () => void;
  onForward?: () => void;
  onCharacter?: () => void;
  onGuide?: (event: MouseEvent<HTMLElement>) => void;
  conversationTools?: ReactNode;
  /** On a place or Settings page: "Ask <default Trunk>", which shows that Trunk beside the page (§3.3). */
  ask?: { name: string; open: boolean; onToggle: () => void; help?: boolean } | null;
  /** On a place page: the gear at the start of the header half, which opens Settings (the preview's placeHead). */
  onSettings?: () => void;
};

/** The preview's five header forms, projected from the shared Trunk state. */
export function stateWords(h: Pick<HeaderInfo, "state" | "paused" | "isDefaultTrunk" | "trunkName" | "role" | "room">): string {
  if (h.room) return h.room.line;
  if (h.paused) return "Paused · won’t start anything new";
  if (h.state === "wait") return "Waiting for you";
  // The face state does not distinguish screen control from other tools.
  // Use the preview's state label rather than imply control of the computer.
  if (["think", "work", "search", "read"].includes(h.state)) return STATE_LABEL[h.state];
  const role = h.role || (h.isDefaultTrunk ? "Your Trunk on this computer" : h.trunkName);
  return `${role} · ready`;
}

/** The header name, or its edit field while renaming (§4.1.6 "Rename": the name in an edit field). */
function HeadName({ h }: { h: HeaderInfo }) {
  const [value, setValue] = useState(h.name);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (h.renaming) {
      setValue(h.name);
      ref.current?.select();
    }
  }, [h.renaming, h.name]);
  if (!h.renaming) {
    return h.onProfile ? (
      <b className="head-name" role="button" tabIndex={0} title={`${h.trunkName}’s profile`} style={{ cursor: "pointer" }} onClick={h.onProfile}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), h.onProfile?.())}>{h.name}</b>
    ) : (
      <b className="head-name">{h.name}</b>
    );
  }
  return (
    <input
      ref={ref}
      className="head-name head-edit"
      aria-label="Conversation name"
      data-testid="rename-field"
      value={value}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => h.onRename(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          h.onRename(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          h.onRename(null);
        }
      }}
    />
  );
}

/** The Trunk's face in the header; clicking it shows or hides the character panel. */
function HeaderFace({ header, onCharacter, size = 32 }: { header: HeaderInfo; onCharacter?: () => void; size?: number }) {
  const state = header.state;
  if (header.room) return <span className="header-face">{header.room.faces(size)}</span>;
  return (
    <button className={["think", "work", "search", "read"].includes(state) ? "header-face working-ring" : "header-face"} type="button" aria-label={header.onProfile ? `${header.trunkName}’s profile` : "Show or hide character"} title={header.onProfile ? `${header.trunkName}’s profile` : undefined} onClick={header.onProfile ?? onCharacter}>
      <Pebble size={size} label={header.trunkName} state={state} priority={300} />
    </button>
  );
}

/** Preview headDotT5: the chat header ⋯, with a warn dot when this conversation needs you. */
export function ConversationMoreButton({
  need,
  idleTitle,
  onClick,
}: {
  need: number;
  idleTitle?: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  const label = conversationMoreLabel(need, CONVERSATION_MORE_IDLE_LABEL);
  return (
    <button type="button" className={need > 0 ? "ib dotsT5" : "ib"} aria-label={label} title={need > 0 ? label : idleTitle ?? label} data-testid="conversation-menu-button" onClick={onClick}>
      <Icon name="more" />
      {need > 0 ? <span className="dotsDotT5" aria-hidden="true" /> : null}
    </button>
  );
}

/** The conversation header as its own row in the main column (narrow windows and focus mode, §3.2). */
export function HeaderRow({ header, onCharacter, tools, onList, onBack, onForward }: { header: HeaderInfo; onCharacter?: () => void; tools?: ReactNode; onList?: () => void; onBack?: () => void; onForward?: () => void }) {
  const live = !header.room && ["think", "work", "search", "read", "wait"].includes(header.state);
  const tint = useHeaderTint(header);
  return (
    <div className={`head-row${live ? " live" : ""}${tint ? " tinted" : ""}`} style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}>
      <button type="button" className="ib" aria-label="Back" title="Back" onClick={onBack}><Icon name="back" /></button>
      <button type="button" className="ib" aria-label="Forward" title="Forward" onClick={onForward}><Icon name="forward" /></button>
      {onList ? <button type="button" className="ib" aria-label="Conversations" title="Conversations" data-testid="list-toggle" onClick={onList}><Icon name="menu" /></button> : null}
      <HeaderFace header={header} onCharacter={onCharacter} size={56} />
      {!header.room ? <span className="head-status-announcement" role="status" aria-live="polite" aria-atomic="true">{header.trunkName}: {stateWords(header)}</span> : null}
      <div className="head-text">
        <HeadName h={header} />
        <span className={live ? "head-state live" : "head-state"} data-face-state={header.state}>
          {live ? <i aria-hidden="true" /> : null}
          {stateWords(header)}
        </span>
      </div>
      {tools ? <div className="global head-tools">{tools}</div> : null}
    </div>
  );
}

/** A place's 58 px row under the 34 px bar (narrow windows, the preview's placeHead): ≡ shows the list, the gear opens Settings. */
export function PlaceHead({ onList, onSettings, onBack, onForward }: { onList: () => void; onSettings: () => void; onBack?: () => void; onForward?: () => void }) {
  return (
    <div className="place-head" data-testid="place-head">
      {onBack ? <button type="button" className="ib" aria-label="Back" title="Back" onClick={onBack}><Icon name="back" /></button> : null}
      {onForward ? <button type="button" className="ib" aria-label="Forward" title="Forward" onClick={onForward}><Icon name="forward" /></button> : null}
      <button type="button" className="ib" aria-label="Show conversations" title="Show conversations" onClick={onList}>
        <Icon name="menu" />
      </button>
      <button type="button" className="ib" aria-label="Settings" title="Settings" onClick={onSettings}>
        <Icon name="gear" />
      </button>
    </div>
  );
}

/** The tint line's colour (§4.2.1): the conversation's colour at 40%; the classic pebble's --ink-2 when the Trunk wears it;
 *  none for a character without a colour (the tint is "drawn only when the conversation has a colour"). */
export function useHeaderTint(header: Pick<HeaderInfo, "colour" | "trunkName" | "room"> | null): string | null {
  const appearance = useTrunkAppearance(header?.trunkName);
  if (!header || header.room) return null;
  if (header.colour) return /^#[0-9a-f]{6}$/i.test(header.colour) ? `${header.colour}66` : `color-mix(in srgb, ${header.colour} 40%, transparent)`;
  return appearance ? null : "color-mix(in srgb, var(--ink-2) 40%, transparent)";
}

/** The merged 52 px top bar (DESIGN-SPEC §3.2): the machine switcher over the sidebar, the conversation header, the global buttons. */
export function TopBar({ compact, machine, header, dark, listHidden, onToggleList, onBack, onForward, onCharacter, onGuide, conversationTools, ask, onSettings }: Props) {
  const live = header !== null && !header.room && ["think", "work", "search", "read", "wait"].includes(header.state);
  const tint = useHeaderTint(compact ? null : header);
  // The app's window buttons sit over this bar's top-right; keep their colours and height matched to it.
  useEffect(syncTitleBar, [dark, compact, listHidden]);
  return (
    <header className={tint ? "topbar tinted" : "topbar"} style={tint ? ({ "--tint": tint } as CSSProperties) : undefined}>
      <div className="topbar-left">{machine}</div>
      <div className="topbar-right">
        {compact ? (
          <span className="head" />
        ) : header ? (
          <div className="head">
            <button type="button" className="ib" aria-label="Back" title="Back" onClick={onBack}><Icon name="back" /></button>
            <button type="button" className="ib" aria-label="Forward" title="Forward" onClick={onForward}><Icon name="forward" /></button>
            <HeaderFace header={header} onCharacter={onCharacter} />
            <div className="head-text">
              <HeadName h={header} />
              <span className={live ? "head-state live" : "head-state"} data-face-state={header.state} aria-live="polite" aria-atomic="true">
                {live ? <i aria-hidden="true" /> : null}
                {stateWords(header)}
              </span>
            </div>
          </div>
        ) : (
          <div className="head">
            <button type="button" className="ib" aria-label="Back" title="Back" onClick={onBack}><Icon name="back" /></button>
            <button type="button" className="ib" aria-label="Forward" title="Forward" onClick={onForward}><Icon name="forward" /></button>
            {onSettings ? (
              <button type="button" className="ib" aria-label="Settings" title="Settings" data-testid="place-settings" onClick={onSettings}>
                <Icon name="gear" />
              </button>
            ) : null}
          </div>
        )}
        <div className="global">
          {header && !compact ? <span className="conv-tools">{conversationTools}</span> : null}
          {!header && onGuide ? <button type="button" className="ib guide-btn" title="Guide" data-testid="guide" onClick={onGuide}><Icon name="help" small /><span>Guide</span></button> : null}
          {ask ? (
            <button type="button" className="ib talk-btn" aria-label={ask.help ? "Help for this page" : `Ask ${ask.name}`} title={ask.help ? "Help for this page" : `Ask ${ask.name}`} aria-haspopup={ask.help ? "dialog" : undefined} aria-pressed={ask.help ? undefined : ask.open} data-testid="ask-default" onClick={ask.onToggle}>
              {ask.help ? "?" : <Icon name="ask" small />}
            </button>
          ) : null}
          {!compact ? <button
            type="button"
            className="ib"
            aria-label={listHidden ? "Show the list · Ctrl+B" : "Hide the list · Ctrl+B"}
            title={listHidden ? "Show the list (Ctrl+B)" : "Hide the list (Ctrl+B)"}
            aria-pressed={!listHidden}
            data-testid="list-toggle"
            onClick={(e: MouseEvent) => {
              e.currentTarget instanceof HTMLElement && e.currentTarget.blur();
              onToggleList();
            }}
          >
            <Icon name={listHidden ? "sidebarOff" : "sidebar"} small />
          </button> : null}
        </div>
      </div>
    </header>
  );
}
