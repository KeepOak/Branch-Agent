import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { GitHubConnection } from "./github-connection";
import { Btn, Ctl, Pill, Sec, Val, useScope } from "./kit";
import { Logo } from "./set1/service";
import { configStore } from "./config-store";

/** An explicit agent pins embedded controls to their edited Trunk, not the active Settings scope. */
export function GitHubSettings({ engine, agentId: owner }: { engine: WindowEngine; agentId?: string }) {
  const selected = useScope();
  const agentId = owner ?? selected ?? engine.agentId;
  if (!agentId) return <Sec title="GitHub"><p>Select a Trunk to read its GitHub connection.</p></Sec>;
  const scope = owner !== undefined || selected !== null ? "agent" : "system";
  return <GitHubOwner key={`${scope}:${agentId}`} engine={engine} agentId={agentId} scope={scope} />;
}
function GitHubOwner({ engine, agentId, scope }: { engine: WindowEngine; agentId: string; scope: "agent" | "system" }) {
  const [, redraw] = useState(0);
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  useEffect(() => {
    const controller = new GitHubConnection(engine, agentId, scope, () => redraw(n => n + 1));
    setConnection(controller); void controller.refresh();
    return () => controller.dispose();
  }, [engine, agentId, scope]);
  const view = connection?.view;
  // Shared settings must show the shared identity even when this Trunk has an override.
  const identity = scope === "system" ? view?.status?.selected.identity : view?.status?.effective;
  const admin = engine.scopes.includes("operator.admin");
  const status = view?.status;
  useEffect(() => { if (status) void configStore(engine).load(); }, [engine, status]);
  const sub = identity ? `${identity.source === "agent-override" ? "This Trunk’s account" : identity.source === "system-configured" ? "Shared account" : "This computer’s account"} · ${identity.credentialKind === "managed-oauth" ? "GitHub sign-in" : identity.credentialKind === "managed-pat" ? "Managed token" : "Native sign-in"}` : view?.phase === "loading" || !view ? "Reading connection…" : "Connect GitHub or refresh to try again.";
  const pill = <Pill tone={identity?.credentialState === "available" ? "ok" : "idle"}>{identity ? identity.credentialState.replaceAll("_", " ") : view?.phase === "loading" || !view ? "Checking" : "Not connected"}</Pill>;
  return <Sec title="GitHub" hint={scope === "agent" ? "For this Trunk. Existing work keeps its original identity." : "For Trunks without their own GitHub connection."}>
    {view?.error && <p role="alert" className="hint">{view.error}</p>}
    <Ctl id="GitHub" icon={<Logo id="github-copilot" size={22} />} title={<>{identity?.account ? `@${identity.account.login}` : "GitHub"}{pill}</>} sub={sub}>
      {view?.busy ? <Btn sm disabled={!admin || view.phase === "cancelling" || view.phase === "saving" || !connection} onClick={() => void connection?.cancel()}>{view.phase === "saving" ? "Saving…" : "Cancel sign-in"}</Btn> : <Btn sm pri disabled={!admin || !connection || view?.phase === "loading"} onClick={() => void connection!.start()}>{view?.status?.selected.configured ? "Change account" : "Connect GitHub"}</Btn>}
      {view?.status?.selected.configured && <Btn sm disabled={!admin || view.busy} onClick={() => void connection!.inherit()}>{scope === "agent" ? "Use shared account" : "Use computer’s account"}</Btn>}
      <Btn sm disabled={!connection || view?.busy || view?.phase === "loading"} onClick={() => void connection?.refresh()}>Refresh</Btn>
    </Ctl>
    {identity && <>
      <Ctl title="Permissions" sub={identity.oauthScopes.length ? identity.oauthScopes.join(", ") : "No scopes reported"}><Val>Repository access is not reported</Val></Ctl>
      <Ctl title="Access expires" sub={identity.accessExpiresAtMs === null ? "Not reported" : new Date(identity.accessExpiresAtMs).toLocaleString()}><Val>Refresh: {identity.refreshState.replaceAll("_", " ")}</Val></Ctl>
    </>}
    {view?.device && <div role="status" className="status bs-alert">
      <div className="grow">
        <b>Enter <strong>{view.device.userCode}</strong> on GitHub.</b>
        <p><a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer">Open GitHub sign-in</a> · Code expires {new Date(view.expiresAt!).toLocaleTimeString()} · {view.phase.replaceAll("_", " ")}</p>
      </div>
    </div>}
    {!admin && <p className="hint">Only someone who may change Branch’s setup can connect or remove a shared account.</p>}
    <p className="hint">Removing this connection retires its managed sign-in in Branch. To revoke access on GitHub, <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer">manage authorized applications</a>.</p>
  </Sec>;
}
