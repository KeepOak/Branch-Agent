// What's new (DESIGN-SPEC §4.8.3, Q83): one dialog for every entry point. The installed version lists what this
// window brought, each row opening its place; a version waiting to install lists the engine's own update notes
// (update.status updateAvailable.commits) and offers "Install when idle".
import { useState } from "react";
import { isNewerBranchVersion, versionParts } from "../connect/branch-version";
import { installOnComputer } from "../connect/desktop-component-updates";
import { Dialog } from "./Dialog";
import { Icon, type IconName } from "./icons";
import type { UpdateInfo } from "./status-data";
import "./whats-new.css";

export type NewRow = { icon: IconName; title: string; line: string; run: () => void };
export type NewGroups = { New: NewRow[]; Better: NewRow[]; Fixed: NewRow[] };

type Props = {
  version: string;
  update: UpdateInfo | null;
  /** Rows for the installed version, by group. */
  installed: NewGroups;
  onOpenUpdates: () => void;
  onInstall: () => void;
  onClose: () => void;
  /** Open on the waiting version (the version menu's "What's new"). */
  startOnReady?: boolean;
  desktopInstall?: boolean;
  computerName?: string;
};

function Rows({ title, rows, close }: { title: string; rows: NewRow[]; close: () => void }) {
  if (!rows.length) {
    return null;
  }
  return (
    <div className="wn-g">
      <h3>{title}</h3>
      <div className="new13">
        {rows.map((r) => (
          <button key={r.title} type="button" className="new-row13" onClick={() => (close(), r.run())}>
            <span className="ico-tile">
              <Icon name={r.icon} small />
            </span>
            <span className="grow">
              <b>{r.title}</b>
              <small>{r.line}</small>
            </span>
            <Icon name="chev" small />
          </button>
        ))}
      </div>
    </div>
  );
}

export function WhatsNew(p: Props) {
  const ready = p.version.trim() && p.update?.latest && isNewerBranchVersion(p.update.latest, p.version) ? p.update.latest : null;
  const [on, setOn] = useState<"installed" | "ready">(p.startOnReady && ready ? "ready" : "installed");
  const notes = ready ? (p.update?.notes ?? []) : [];
  const waiting: NewGroups = { New: [], Better: notes.map((n) => ({ icon: "check", title: n, line: "Read about it in Updates & about.", run: p.onOpenUpdates })), Fixed: [] };
  const showingReady = on === "ready" && Boolean(ready);
  const groups = showingReady ? waiting : p.installed;
  const footer = (
    <>
      {showingReady && p.desktopInstall ? (
        <button type="button" className="btn" data-testid="wn-install" disabled={p.update?.installing} onClick={() => (p.onClose(), p.onInstall())}>
          Install when idle
        </button>
      ) : null}
      <button type="button" className="btn primary" onClick={p.onClose}>
        Done
      </button>
    </>
  );
  return (
    <Dialog title="What’s new" wide onClose={p.onClose} testid="whats-new" footer={footer}>
      {ready ? (
        <span className="seg wn-seg" role="radiogroup" aria-label="Version" style={{ gridTemplateColumns: "repeat(2, auto)", ["--i" as string]: on === "ready" ? 1 : 0, ["--n" as string]: 2 }}>
          <button type="button" role="radio" aria-checked={on === "installed"} onClick={() => setOn("installed")}>
            Branch {versionParts(p.version).short} · installed
          </button>
          <button type="button" role="radio" aria-checked={on === "ready"} onClick={() => setOn("ready")}>
            Branch {versionParts(ready).short} · ready
          </button>
        </span>
      ) : null}
      <p className="hint wn-hint">{on === "ready" && ready ? p.desktopInstall ? `What Branch ${versionParts(ready).short} brings. It installs when nothing is running and keeps a safety copy first.` : installOnComputer(p.computerName ?? "") : `What Branch ${versionParts(p.version).short} brought, and where each part lives.`}</p>
      {showingReady && !notes.length ? <p className="hint">The update didn't say what it changes.</p> : null}
      <Rows title="New" rows={groups.New} close={p.onClose} />
      <Rows title="Better" rows={groups.Better} close={p.onClose} />
      <Rows title="Fixed" rows={groups.Fixed} close={p.onClose} />
    </Dialog>
  );
}

/** What this window brought, each row opening the real place (§4.8.3 rule 1). */
export function installedRows(go: { setup: () => void; shortcuts: () => void; palette: () => void; settings: (page: string) => void }): NewGroups {
  return {
    New: [
      { icon: "spark", title: "Setup and the walkthrough", line: "11 short steps, then a walkthrough of each part.", run: go.setup },
      { icon: "clock", title: "Account allowances", line: "Click the ring for each account’s limits and context left.", run: () => go.settings("usage") },
      { icon: "menu", title: "Shortcuts you choose", line: "Click a shortcut, then press the keys you want.", run: go.shortcuts },
    ],
    Better: [
      { icon: "search", title: "Find anything", line: "Conversations, places, settings and commands from one box. Ctrl K.", run: go.palette },
      { icon: "users", title: "Accounts sign in from Settings", line: "Add an account and set the order Branch uses them in.", run: () => go.settings("accounts") },
    ],
    Fixed: [],
  };
}
