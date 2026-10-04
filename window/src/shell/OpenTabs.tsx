// The strip of open conversations under the message box (the preview's tabsR118, ledger SESSIONS-0077): the last six
// conversations opened in this window, newest first. Shown once two are open; × closes a tab (the open one moves to
// the next tab).
import { useEffect, useState } from "react";
import { Icon } from "./icons";

const MAX = 6;

/** Keeps the opened keys, newest first, at most six. */
export function useOpenTabs(openKey: string | null): { keys: string[]; close: (key: string) => string | null } {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    if (openKey) setKeys((cur) => [openKey, ...cur.filter((k) => k !== openKey)].slice(0, MAX));
  }, [openKey]);
  const close = (key: string) => {
    const rest = keys.filter((k) => k !== key);
    setKeys(rest);
    return key === openKey ? rest[0] ?? null : null;
  };
  return { keys, close };
}

type Props = { keys: string[]; openKey: string | null; name: (key: string) => string; onOpen: (key: string) => void; onClose: (key: string) => void };

export function OpenTabs({ keys, openKey, name, onOpen, onClose }: Props) {
  if (keys.length < 2) return null;
  return (
    <nav className="open-tabs" aria-label="Open conversations" data-testid="open-tabs">
      {keys.map((key) => (
        <span key={key} className={key === openKey ? "open-tab on" : "open-tab"}>
          <button type="button" aria-current={key === openKey ? "page" : undefined} onClick={() => onOpen(key)}>{name(key)}</button>
          <button type="button" className="open-tab-x" aria-label={`Close ${name(key)}`} title={`Close ${name(key)}`} onClick={() => onClose(key)}>
            <Icon name="x" small />
          </button>
        </span>
      ))}
    </nav>
  );
}
