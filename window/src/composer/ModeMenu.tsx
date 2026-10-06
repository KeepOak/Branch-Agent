// The permission mode menu (DESIGN-SPEC §4.3.4): this conversation's mode only (DECISIONS.md item 41), keys 1–5
// (item 42), Full access only for the owner (item 128). Picking writes sessions.patch { permissionMode }.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useRef, type RefObject } from "react";
import { blockedReason, modeName, MODE_ROWS, type EngineMode } from "./mode";
import { NO_ROUTE, type OpenTarget } from "./nav";
import { Popover, moveFocus } from "./Popover";
import { MenuItem, Segmented, Sep, Switch } from "./ui";
import { Icon } from "./icons";
import { str, type Rec } from "./engine";
import { shows, useLevel } from "../places-nav/level";
import { shownWhy } from "../shell/shown-why";

type Props = {
  embedded?: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  mode: EngineMode | null;
  asSet: EngineMode | null;
  canSelectFull: boolean;
  onPick: (mode: EngineMode | null) => void;
  onOpen?: (target: OpenTarget) => void;
  /** This conversation's row: its sandbox opt-out and elevated level. */
  row: Rec;
  /** sessions.patch { elevatedLevel } for "Outside the sealed box"; null puts it back to as set. */
  onElevated: (level: string | null) => void;
};

const FULL_ONLY = "Only the owner can run commands outside the sealed box.";
const LOCKDOWN_GAP = "Not available in this engine yet: the engine has no Lockdown switch.";
const ROLE_GAP = "Not available in this engine yet: a conversation can't take a role.";
// The preview's built-in roles (Roo Code's modes): what each one does in a conversation.
const ROLES = [
  ["Ask", "Answers and explains; changes nothing"],
  ["Architect", "Plans and designs before any change"],
  ["Code", "Writes and changes code"],
  ["Debug", "Finds the cause of a problem first"],
  ["Orchestrator", "Splits big work between helpers"],
  ["Release notes", "Summarizes what changed for a release"],
] as const;
const ELEVATED = [
  { id: "off", label: "Off" },
  { id: "on", label: "On" },
  { id: "full", label: "Full" },
];

export function ModeMenu(p: Props) {
  const body = useRef<HTMLDivElement>(null);
  const advanced = shows(useLevel(), "advanced");
  // Commands run in the sealed box unless this conversation opted out of it (sandboxMode "off").
  const sealed = p.row.sandboxMode !== "off";
  const onKey = (e: React.KeyboardEvent) => {
    if (/^[1-5]$/.test(e.key)) {
      const row = MODE_ROWS[Number(e.key) - 1];
      if (row && !blockedReason(row, p.canSelectFull)) {
        e.preventDefault();
        p.onPick(row.engine);
      }
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveFocus(body.current, e.key === "ArrowDown" ? 1 : -1);
    }
  };
  const content = (
      <div ref={body} onKeyDown={onKey}>
        <div className="c-pt">How much may it do in this conversation?</div>
        <MenuItem
          testId="mode-option"
          top
          icon="gear"
          label={p.asSet ? `As set · ${modeName(p.asSet)}` : "As set"}
          sub="From Settings › Permissions"
          checked={p.mode === null}
          onClick={() => p.onPick(null)}
        />
        {MODE_ROWS.map((row, i) => {
          const reason = blockedReason(row, p.canSelectFull);
          const on = row.engine !== null && row.engine === p.mode;
          return (
            <MenuItem
              key={row.name}
              testId="mode-option"
              top
              icon={row.icon}
              label={row.name}
              sub={row.line}
              danger={row.engine === "full"}
              checked={on}
              right={on ? undefined : <kbd>{i + 1}</kbd>}
              disabled={Boolean(reason)}
              reason={reason ?? undefined}
              reasonLine
              onClick={() => p.onPick(row.engine)}
            />
          );
        })}
        {advanced && sealed ? (
          <>
            <Sep />
            <div className="c-row c-elev">
              <span className="c-mi-t">
                <span>Outside the sealed box</span>
                <small>{p.canSelectFull ? "Run commands on this computer itself in this conversation." : "Not available here: this conversation must stay in the sealed box."}</small>
              </span>
              <Segmented
                label="Outside the sealed box"
                items={ELEVATED}
                value={p.canSelectFull ? str(p.row.elevatedLevel) : "off"}
                disabled={!p.canSelectFull}
                reason={p.canSelectFull ? undefined : FULL_ONLY}
                onPick={(id) => p.onElevated(id)}
              />
            </div>
          </>
        ) : null}
        <Sep />
        <MenuItem
          icon="gear"
          label="Change it everywhere…"
          disabled={!p.onOpen}
          reason={p.onOpen ? undefined : NO_ROUTE}
          onClick={() => {
            p.onClose();
            p.onOpen?.("settings/permissions");
          }}
        />
        <div className="c-row c-lockdown" title={shownWhy(LOCKDOWN_GAP)}>
          <span className="c-lock-t"><Icon name="lock" size={15} />Lockdown</span>
          <Switch on={false} label="Lockdown" disabled reason={LOCKDOWN_GAP} onChange={() => undefined} />
        </div>
        <Sep />
        <div className="c-pt">Role here</div>
        {ROLES.map(([name, line]) => (
          <MenuItem key={name} label={name} sub={line} disabled reason={ROLE_GAP} />
        ))}
        <MenuItem icon="up" label="Export your roles…" disabled reason={ROLE_GAP} />
        <MenuItem icon="down" label="Import roles…" disabled reason={ROLE_GAP} />
      </div>
  );
  return p.embedded ? content : <Popover anchor={p.anchor} onClose={p.onClose} label="How much may it do in this conversation?" className="c-mode">{content}</Popover>;
}
