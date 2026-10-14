import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Access } from "./Access";
import { ChatApps } from "./ChatApps";
import { SetupWizard } from "./SetupWizard";
import { WhatsAppSetup } from "./WhatsAppSetup";
import { Manage } from "./Manage";
import type { ChatApp } from "./catalogue";

/** Host slot for Settings and onboarding; all channel calls use the existing engine handle. */
export function ChatAppsPage({ engine }: { engine: WindowEngine }) {
  const [dialog, setDialog] = useState<{ app: ChatApp; manage: boolean }>();
  const [revision, setRevision] = useState(0);
  const close = () => { setDialog(undefined); setRevision(v => v + 1); };
  return <><ChatApps key={revision} engine={engine} renderAccess={app => <Access engine={engine} app={app} />} onSetup={app => setDialog({ app, manage: false })} onManage={app => setDialog({ app, manage: true })} />
    {dialog && (dialog.manage ? <Manage engine={engine} app={dialog.app} onClose={close} onSetup={() => setDialog({ ...dialog, manage: false })} /> : dialog.app.id === "whatsappweb" ? <WhatsAppSetup engine={engine} app={dialog.app} onClose={close} /> : <SetupWizard engine={engine} app={dialog.app} onClose={close} />)}
  </>;
}
