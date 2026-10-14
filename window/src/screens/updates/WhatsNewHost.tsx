// What's new in the R1 window (HANDOFF: it lives in Settings › Updates & about, as one dialog). The Classic dialog
// (shell/WhatsNew.tsx) is re-hosted unchanged: Updates & about's What's new row sends branch:whats-new, as the Classic
// window's Guide menu does, and this opens it with the installed version's rows and any waiting update's notes.
import { useEffect, useState } from "react";
import { useBranchVersion } from "../../connect/branch-version";
import { componentDesktop } from "../../connect/desktop-component-updates";
import type { SaplingSession } from "../../connect/session";
import { useMachine } from "../../shell/engine-data";
import { useUpdate } from "../../shell/use-status";
import { installedRows, WhatsNew } from "../../shell/WhatsNew";

export const WHATS_NEW_EVENT = "branch:whats-new";

type Go = {
  /** Opens a Settings page by its R1 id. */
  onSettings: (page: string) => void;
  /** Find anything: the sidebar search. */
  onSearch: () => void;
  /** Setup, from its first step. */
  onSetup: () => void;
  /** A line for the window's notice, when installing fails. */
  onNotice: (text: string) => void;
};

export function WhatsNewHost({ session, ready, ...go }: Go & { session: SaplingSession; ready: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(WHATS_NEW_EVENT, show);
    return () => window.removeEventListener(WHATS_NEW_EVENT, show);
  }, []);
  return open ? <Open session={session} ready={ready} {...go} onClose={() => setOpen(false)} /> : null;
}

function Open({ session, ready, onSettings, onSearch, onSetup, onClose }: Go & { session: SaplingSession; ready: boolean; onClose: () => void }) {
  const version = useBranchVersion(session.gatewayUrl);
  const update = useUpdate(session, ready, version);
  const machine = useMachine(session, ready);
  return <WhatsNew
    clear
    version={version}
    update={update}
    desktopInstall={Boolean(componentDesktop(session.gatewayUrl)?.componentUpdates)}
    computerName={machine?.name ?? ""}
    // Keyboard shortcuts live in Settings › General in R1; Find anything is the sidebar search.
    installed={installedRows({ setup: onSetup, shortcuts: () => onSettings("general"), palette: onSearch, settings: onSettings })}
    onOpenUpdates={() => onSettings("updates")}
    onClose={onClose}
  />;
}
