// Keyboard shortcuts (DESIGN-SPEC §4.8.8 and its parity adds): every shortcut, the settable ones set by pressing the
// keys, the side panel's own keys, the fixed keys and the row menu's letters.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";
import { checkCombo, comboOf, currentKeys, keyActions, PANE_ACTIONS, readCustomKeys, saveCustomKeys, shown, type ActionId, type KeyAction } from "./keymap";
import { notify } from "./notify";
import "./shortcuts.css";

const DESKTOP_ANY = "Keys from any app belong to the desktop app, which doesn't offer them yet.";
const DESKTOP_ASK = "Quick ask from any app belongs to the desktop app, which doesn't offer it yet.";

/** The fixed keys (§4.8.8 Fixed list and its parity adds), as the preview lists them. */
const FIXED: [string, string[], string?][] = [
  ["New line in a message", ["Shift", "Enter"]],
  ["Call a Trunk in a message", ["@"]],
  ["Use a skill", ["/"]],
  ["This list", ["?"]],
  ["Close anything", ["Esc"]],
  ["Send", ["Enter"], "Ctrl Enter when Send with is set so"],
  ["Steer with the waiting message", ["Ctrl", "Enter"]],
  ["Your earlier messages", ["↑", "↓"]],
  ["Find in this conversation", ["Ctrl", "F"]],
  ["Hide or show the list", ["Ctrl", "B"]],
  ["Focus sidebar search", ["Ctrl", "G"]],
  ["Search past sessions", ["Ctrl", "P"]],
  ["Cancel a quoted reply or dictation", ["Esc"]],
  ["Save an edit to a waiting message", ["Ctrl", "Enter"]],
  ["Pick one of the first nine computers", ["Ctrl", "1", "…", "Ctrl", "9"]],
  ["Select several conversations", ["Alt", "Click"]],
  ["Extend the selection", ["Shift", "Click"]],
];

/** The letters a conversation's row menu answers to (shell/row-menu.ts and row-look.tsx). */
const ROW_LETTERS: [string, string][] = [
  ["Pin or unpin", "P"],
  ["Rename", "R"],
  ["Mark as unread or read", "U"],
  ["Archive or restore", "A"],
  ["Copy into a new conversation", "F"],
  ["Delete…", "D"],
  ["Icon and colour", "I"],
  ["Copy", "C"],
];

function Kbds({ keys, mac }: { keys: string[]; mac: boolean }) {
  return (
    <>
      {shown(keys.join(" "), mac).map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </>
  );
}

function Shortcuts({ rows, mac, className }: { rows: [ReactNode, string[]][]; mac: boolean; className?: string }) {
  return (
    <div className={className ? `shortcuts ${className}` : "shortcuts"}>
      {rows.map(([what, keys], i) => [
        <span key={`w${i}`}>{what}</span>,
        <span key={`k${i}`}>
          <Kbds keys={keys} mac={mac} />
        </span>,
      ])}
    </div>
  );
}

type RowProps = { a: KeyAction; keys: Record<ActionId, string>; custom: Partial<Record<ActionId, string>>; listening: ActionId | null; mac: boolean; onListen: (id: ActionId | null) => void; onReset: (id: ActionId) => void };

function KeyRow({ a, keys, custom, listening, mac, onListen, onReset }: RowProps) {
  return (
    <div className="k-row15">
      <span>{a.name}</span>
      <button type="button" className={listening === a.id ? "k-set15 listen15" : "k-set15"} data-testid={`key-${a.id}`} aria-label={`${a.name}: ${keys[a.id]}. Change`} disabled={Boolean(a.off)} title={a.off} onClick={() => onListen(listening === a.id ? null : a.id)}>
        {listening === a.id ? <em>Press the keys…</em> : <Kbds keys={keys[a.id].split(" ")} mac={mac} />}
      </button>
      {custom[a.id] ? (
        <button type="button" className="ib sm" aria-label={`Put back ${a.keys}`} title={`Put back ${a.keys}`} onClick={() => onReset(a.id)}>
          <Icon name="x" size={13} />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

export function ShortcutsDialog({ onClose, defaultName = "Sapling" }: { onClose: () => void; defaultName?: string }) {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const actions = useMemo(() => keyActions(defaultName), [defaultName]);
  const [custom, setCustom] = useState(readCustomKeys);
  const [listening, setListening] = useState<ActionId | null>(null);
  const keys = currentKeys(actions, custom);
  const set = (next: typeof custom) => {
    setCustom(next);
    saveCustomKeys(next);
  };
  useEffect(() => {
    if (!listening) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setListening(null);
        return;
      }
      const combo = comboOf(e, mac);
      if (!combo) {
        return; // a modifier on its own
      }
      const action = actions.find((a) => a.id === listening);
      const check = checkCombo(combo, listening, actions, keys);
      setListening(null);
      if (!check.ok) {
        notify(check.reason);
        return;
      }
      set({ ...custom, [listening]: combo === action?.keys ? undefined : combo });
      notify(`${action?.name}: ${shown(combo, mac).join(" ")}.`);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  const row = (a: KeyAction) => <KeyRow key={a.id} a={a} keys={keys} custom={custom} listening={listening} mac={mac} onListen={setListening} onReset={(id) => set({ ...custom, [id]: undefined })} />;
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose} testid="shortcuts">
      <p className="hint k-hint">Click a shortcut, then press the keys you want.</p>
      <div className="k-anyPF18">
        <div className="ctl">
          <b>Keys that work from any app</b>
          <button type="button" role="switch" aria-checked={false} aria-label="Keys that work from any app" className="switch" disabled title={DESKTOP_ANY} />
          <small>Talk live and Settings from any app, without switching to Branch.</small>
        </div>
      </div>
      <div className="keys15" data-listening={listening ?? undefined}>
        {actions.filter((a) => !PANE_ACTIONS.includes(a.id)).map(row)}
        <div className="k-row15 kqPF18">
          <span>
            <span className="kq-tPF18">
              <span>Quick ask, from any app</span>
              <small>A small box for a quick question, from any app.</small>
            </span>
            <button type="button" role="switch" aria-checked={false} aria-label="Quick ask, from any app" className="switch" disabled title={DESKTOP_ASK} />
          </span>
          <button type="button" className="k-set15" disabled title={DESKTOP_ASK} aria-label={`Quick ask, from any app: ${mac ? "Alt Space" : "Ctrl Shift Space"}. Change`}>
            <Kbds keys={mac ? ["Alt", "Space"] : ["Ctrl", "Shift", "Space"]} mac={mac} />
          </button>
          <span />
        </div>
      </div>
      <div className="k-groupPF18">
        <h3>Side panel</h3>
        <div className="keys15">{actions.filter((a) => PANE_ACTIONS.includes(a.id)).map(row)}</div>
      </div>
      <Shortcuts
          className="k-fixed15"
          mac={mac}
          rows={FIXED.map(([what, combo, note]) => [
            note ? (
              <>
                {what}
                <small className="k-notePF18">{note}</small>
              </>
            ) : (
              what
            ),
            combo,
          ])}
        />
      <div className="k-groupPF18">
        <h3>In a row menu</h3>
        <Shortcuts mac={mac} rows={ROW_LETTERS.map(([what, letter]) => [what, [letter]])} />
      </div>
    </Dialog>
  );
}
