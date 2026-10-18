import { useEffect, useState } from "react";
import { accountsOf, providersOf, type Account } from "../places/settings/set1/accounts";
import { str, type Rec, type WindowEngine } from "./engine";

export function useModelAccounts(engine: WindowEngine | undefined, agentId: string, working: boolean): Account[] {
  const [state, setState] = useState<{ engine?: WindowEngine; agentId: string; accounts: Account[] }>({ agentId: "", accounts: [] });
  useEffect(() => {
    if (!engine || !agentId) return;
    let live = true;
    void engine.request("models.authStatus", { agentId }).then(
      (result) => { if (live) setState({ engine, agentId, accounts: accountsOf(providersOf((result as Rec | null)?.providers)) }); },
      () => { if (live) setState({ engine, agentId, accounts: [] }); },
    );
    return () => { live = false; };
  }, [engine, agentId, working]);
  return state.engine === engine && state.agentId === agentId ? state.accounts : [];
}

/** A pinned session account wins; otherwise show the last successful account for this Trunk. */
export function currentModelAccount(accounts: Account[], provider: string, row: Rec): Account | undefined {
  const matching = accounts.filter((account) => account.p.provider === provider || account.p.authProvider === provider);
  const selected = str(row.authProfileOverride) || matching[0]?.p.lastGoodProfileId;
  return matching.find((account) => account.a.profileId === selected) ?? matching[0];
}

export function modelAccountTooltip(account: Account | undefined): string {
  if (!account) return "Model and how long it thinks";
  const usage = account.p.usage?.accountEmail?.toLowerCase() === account.a.email?.toLowerCase()
    ? account.p.usage : undefined;
  const windows = usage?.windows?.map((window) =>
    `${window.label ?? "Usage"}: ${Math.round(window.usedPercent ?? 0)}% used`,
  ) ?? [];
  return [account.a.email ?? account.a.displayName ?? account.a.profileId, ...windows].join(" · ");
}

export function shortAccountEmail(account: Account | undefined): string {
  const email = account?.a.email;
  if (!email) return "";
  const at = email.indexOf("@");
  return at > 0 ? `${email.slice(0, Math.min(at, 16))}@…` : email.slice(0, 18);
}
