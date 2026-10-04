// Accounts › Order (Advanced): "Select several", then move the ticked accounts to the top (models.authOrderSet per
// service, since each service keeps its own order) or sign out of them (models.authLogout per service).
import type { WindowEngine } from "../../../connect/engine";
import { Btn, useSaveRunner } from "../kit";
import { useAction } from "../hooks";
import type { Account } from "./accounts";
import "./accounts.css";

const PAUSE_OFF = "Branch can’t pause an account yet.";
const key = (acc: Account) => `${acc.p.provider}/${acc.a.profileId}`;

export function SelectLink({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return <button type="button" className="link-acc" onClick={onToggle}>{on ? "Done" : "Select several"}</button>;
}

export function SelectBox({ acc, name, picked, onPick }: { acc: Account; name: string; picked: string[]; onPick: (next: string[]) => void }) {
  const on = picked.includes(key(acc));
  return <input type="checkbox" className="chk-acc" aria-label={`Select ${name}`} checked={on} onChange={(e) => onPick(e.target.checked ? [...picked, key(acc)] : picked.filter((k) => k !== key(acc)))} />;
}

type BulkProps = { engine: WindowEngine; all: Account[]; picked: string[]; agent: { agentId?: string }; reload: () => Promise<void>; done: () => void };
export function BulkBar({ engine, all, picked, agent, reload, done }: BulkProps) {
  const save = useSaveRunner();
  const action = useAction();
  const chosen = all.filter((acc) => picked.includes(key(acc)));
  const providers = [...new Set(chosen.map((acc) => acc.p))];
  const leaving = chosen.filter((acc) => acc.a.logoutSupported);
  const run = (work: () => Promise<void>) => void action.run(async () => { if (await save(async () => { await work(); await reload(); })) done(); });
  const toTop = () => run(async () => {
    for (const p of providers) {
      const ids = all.filter((x) => x.p === p).map((x) => x.a.profileId);
      const first = chosen.filter((x) => x.p === p).map((x) => x.a.profileId);
      await engine.request("models.authOrderSet", { provider: p.authProvider ?? p.provider, profileIds: [...first, ...ids.filter((id) => !first.includes(id))], ...agent });
    }
  });
  const signOut = () => run(async () => {
    for (const p of [...new Set(leaving.map((acc) => acc.p))]) {
      await engine.request("models.authLogout", { provider: p.authProvider ?? p.provider, profileIds: leaving.filter((x) => x.p === p).map((x) => x.a.profileId), ...agent });
    }
  });
  const n = chosen.length;
  const locked = providers.some((p) => p.profileOrderLocked);
  return (
    <div className="bulk-acc" role="toolbar" aria-label="With the selected accounts">
      <b>{n ? `${n} selected` : "Tick the accounts"}</b>
      <span className="grow" />
      <Btn ghost sm disabled={!n || locked || action.busy} title={locked ? "The order is set in the settings file." : undefined} onClick={toTop}>Move to the top</Btn>
      <Btn ghost sm disabled title={PAUSE_OFF}>Pause</Btn>
      <Btn ghost sm className="danger-acc" disabled={!leaving.length || action.busy} title={n && !leaving.length ? "These sign-ins can’t be removed from here." : undefined} onClick={signOut}>Sign out</Btn>
    </div>
  );
}
