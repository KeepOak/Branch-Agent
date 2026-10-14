// Settings › Accounts & usage: the controls the R1 page draws itself (slots.ts controls), so every working control of
// the Classic Accounts page has its R1 row (R1 README rule 6). Each one reuses Classic's own logic on the same engine
// calls (accounts.tsx, accounts-select.tsx, accounts-more.tsx, add-account.tsx, coding-apps.tsx, own-accounts.tsx and
// GitHubSettings.tsx): the accounts in order with Move up and the ⋯ menu, Select accounts, Add an account, falling back
// to this computer, which account goes next, where each sign-in comes from, your own accounts, coding apps, GitHub and
// the rows that show what the engine reports. The rows of one list share one read, so a change in one row shows in all.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { canAll } from "../../../connect/capabilities";
import { configStore } from "../../../places/settings/config-store";
import { errorText, list, record, text, visible, type RecordValue } from "../../../places/settings/adapter";
import { GitHubConnection, type GitHubView } from "../../../places/settings/github-connection";
import { KitProvider } from "../../../places/settings/kit";
import {
  accountName, accountsOf, accountSub, anotherOffers, answerFirstWhy, firstOrder, isLimited, limitedLabel, movedUp, providersOf, saveOrder,
  signInOffers, signOut, signOutWhy, takeAddRequest, testAccount, type Account, type Provider,
} from "../../../places/settings/set1/accounts";
import { nextModeOf, nextSub, restingOf, setNextMode, setTrunkAccount, shortId, sourceLine, trunkChoices } from "../../../places/settings/set1/accounts-more";
import { key, moveToTop, PAUSE_OFF, signOutAll } from "../../../places/settings/set1/accounts-select";
import { AddAccountDialog, type AddStart } from "../../../places/settings/set1/add-account";
import { APPS, appSub, foundState, PILL, type App } from "../../../places/settings/set1/coding-apps";
import { PickOwn } from "../../../places/settings/set1/own-accounts";
import { Logo, serviceName } from "../../../places/settings/set1/service";
import { Menu, type MenuAnchor, type MenuItem } from "../../../shell/Menu";
import { Segmented, Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";
import { Coming } from "../../../glass/coming";
import { AccountAllowanceList, AccountSpend } from "../../../places/settings/set2/usage";
import { lookStore, useLook } from "../../../places/settings/set1/appearance-store";
import { CKPT_PREF, CKPT_SHOW, useCkptOn } from "../../../shell/SaveProgress";
import { pageFor } from "../nav";
import { useLevel } from "../SettingsFrame";

// One engine read shared by every row that shows it (the accounts list, Select accounts, Which goes next…): a change
// made in one row reloads it once, and every row redraws. It reads again when a row first shows after none did.
type Read = { data?: RecordValue; loading: boolean; error?: string };
class SharedRead {
  snap: Read = { loading: true };
  private subs = new Set<() => void>();
  private gen = 0;
  private engine: WindowEngine;
  private method: string;
  private params: RecordValue;
  constructor(engine: WindowEngine, method: string, params: RecordValue) { this.engine = engine; this.method = method; this.params = params; }
  subscribe(fn: () => void): () => void {
    if (!this.subs.size) void this.reload();
    this.subs.add(fn);
    return () => void this.subs.delete(fn);
  }
  async reload(): Promise<void> {
    const gen = ++this.gen;
    if (!this.snap.loading) this.set({ ...this.snap, loading: true });
    try {
      const data = record(await this.engine.request(this.method, this.params));
      if (gen === this.gen) this.set({ data, loading: false });
    } catch (e) { if (gen === this.gen) this.set({ loading: false, error: errorText(e) }); }
  }
  private set(next: Read) { this.snap = next; for (const fn of [...this.subs]) fn(); }
}
const reads = new WeakMap<WindowEngine, Map<string, SharedRead>>();
function sharedRead(engine: WindowEngine, method: string, params: RecordValue = {}): SharedRead {
  const byKey = reads.get(engine) ?? new Map<string, SharedRead>();
  reads.set(engine, byKey);
  const id = method + " " + JSON.stringify(params);
  let read = byKey.get(id);
  if (!read) { read = new SharedRead(engine, method, params); byKey.set(id, read); }
  return read;
}
export function useRead(engine: WindowEngine, method: string, params: RecordValue = {}) {
  const read = sharedRead(engine, method, params);
  // One subscription per read for as long as the row shows: a new one on every render would read again each time.
  const subscribe = useCallback((fn: () => void) => read.subscribe(fn), [read]);
  const snap = useSyncExternalStore(subscribe, () => read.snap, () => read.snap);
  return { ...snap, reload: () => read.reload() };
}

/** Why this connection can't make a change that needs the engine's admin scope (models.authOrderSet, models.probe,
 *  models.authLogout, models.authLogin, config.patch, branch.setup.detect), or undefined when it can. A connection that
 *  reports no scopes is this computer's own, as in Classic's Local models page. */
const ADMIN_WHY = "Only someone who may change Branch’s setup can change accounts.";
export const adminWhy = (engine: WindowEngine): string | undefined => {
  const scopes = engine.scopes ?? [];
  return !scopes.length || scopes.includes("operator.admin") ? undefined : ADMIN_WHY;
};
/** The same for a person's own accounts (users.selectModelAccount, users.unlinkAuthProfile: write scope). */
export const writeWhy = (engine: WindowEngine): string | undefined => {
  const scopes = engine.scopes ?? [];
  return !scopes.length || scopes.includes("operator.admin") || scopes.includes("operator.write") ? undefined : "Only someone who may make changes can pick their own account.";
};

/** The household's accounts, as Classic reads them: the default Trunk's models.authStatus. */
const agentOf = (engine: WindowEngine): { agentId?: string } => (engine.agentId ? { agentId: engine.agentId } : {});
function useAccounts(engine: WindowEngine) {
  const agent = agentOf(engine);
  const status = useRead(engine, "models.authStatus", agent);
  // The same account objects until the engine answers again, so an open menu's account is one of the list's.
  const providers = useMemo(() => providersOf(status.data?.providers), [status.data]);
  const all = useMemo(() => accountsOf(providers), [providers]);
  return { status, agent, providers, caps: list(status.data?.providerCapabilities), all };
}

/** Classic's dialogs save through its save runner; this reports their failures under the row. */
function Kit({ report, children }: { report: ReturnType<typeof useFailure>[2]; children: ReactNode }) {
  return <KitProvider level={2} report={report} scope={null}>{children}</KitProvider>;
}

const Line = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <small className={"r1s-msg g-label" + (bad ? " r1s-bad" : "")} role={bad ? "status" : undefined} data-lines>{children}</small>;
const Val = ({ children, title }: { children: ReactNode; title?: string }) => <span className="r1s-val g-label" title={title} data-lines>{children}</span>;

/** Classic's accounts status line: reading, couldn't read, not ready, none signed in, or how many. */
function statusLine(status: Read, count: number): { text: string; sub?: string; bad?: boolean } {
  if (status.loading && !status.data) return { text: "Reading your accounts…" };
  if (status.error) return { text: "Branch couldn’t read your accounts", sub: visible(status.error), bad: true };
  const unavailable = record(status.data?.unavailable).message;
  if (unavailable) return { text: "Account health isn’t ready yet", sub: visible(unavailable) };
  if (!count) return { text: "No account signed in", sub: "Add an account so your Trunks have a model to answer with." };
  return { text: count + " " + (count === 1 ? "account" : "accounts") + " signed in", sub: "Branch never sees your passwords. Each account is billed by its own site." };
}

const UP = <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const MORE = <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></svg>;
const COMING = "Coming in a later update.";
const MENU_CALLS = ["models.probe", "models.authOrderSet", "models.authLogout"];

/** An account's plan and state, with the words of Classic's pills (used next, limited until, sign in again). */
const accountLine = (acc: Account): string => [accountSub(acc), acc.ordered && acc.next ? "used next" : "", isLimited(acc.a) ? limitedLabel(acc.a.limitedUntil ?? 0) : "",
  acc.a.status === "expired" || acc.a.status === "missing" ? "Sign in again" : ""].filter(Boolean).join(" · ");

/** Your accounts, in order: the status line, each account with Move up and its ⋯ menu (Test it, Answer first, Rename,
 *  Which Trunks use it, Sign out), as Classic's Order Branch uses them in. */
export function AccountList({ engine }: SlotControlProps) {
  const { status, agent, all } = useAccounts(engine);
  const [failed, run] = useFailure();
  const [open, setMenu] = useState<{ at: MenuAnchor; key: string } | null>(null);
  // The menu's account, by key, from the list as it is now (a reload makes new account objects).
  const menuAcc = open ? all.find((x) => key(x) === open.key) : undefined;
  const menu = open && menuAcc ? { at: open.at, acc: menuAcc } : null;
  const line = statusLine(status, all.length);
  const reorder = (acc: Account, ids: string[]) => void run(async () => { await saveOrder(engine, acc.p, ids, agent); await status.reload(); });
  const admin = adminWhy(engine);
  const can = (method: string) => (canAll(engine, [method]) ? admin : COMING);
  const items = (acc: Account): MenuItem[] => [
    { label: "Test it", disabled: can("models.probe"), run: () => void run(() => testAccount(engine, acc, agent)) },
    { label: "Answer first", disabled: can("models.authOrderSet") ?? answerFirstWhy(acc), run: () => reorder(acc, firstOrder(acc, all)) },
    { label: "Rename", disabled: "Branch can’t rename an account yet.", run: () => undefined },
    { label: "Which Trunks use it", disabled: "Every Trunk uses this account, in this order.", run: () => undefined },
    { kind: "sep" },
    { label: "Sign out", danger: true, disabled: can("models.authLogout") ?? signOutWhy(acc.a), run: () => void run(async () => { await signOut(engine, acc, agent); await status.reload(); }) },
  ];
  return <>
    <span className="r1s-item-t g-label" role="status" data-lines><b>{line.text}</b>{line.sub ? <small className={line.bad ? "r1s-bad" : undefined}>{line.sub}</small> : null}</span>
    {all.length ? (
      <div className="r1s-items">
        {all.map((acc) => {
          const name = accountName(acc);
          const sub = accountLine(acc);
          const upWhy = admin ?? (acc.first ? "First for " + serviceName(acc.p.provider, acc.p.displayName) + " already" : acc.p.profileOrderLocked ? "The order is set in the settings file" : undefined);
          return (
            <div key={key(acc)} className="r1s-item" data-account={key(acc)}>
              <Logo id={acc.p.provider} size={28} />
              <span className="r1s-item-t g-label" data-lines><b>{name}</b>{sub ? <small>{sub}</small> : null}</span>
              <span className="r1s-acts">
                <Needs engine={engine} need={["models.authOrderSet"]} where={"Move up " + name}>
                  <button type="button" className="r1s-btn" aria-label={"Move up " + name} title={upWhy ?? "Move up"} disabled={Boolean(upWhy)} onClick={() => reorder(acc, movedUp(acc, all))}>{UP}</button>
                </Needs>
                <button type="button" className="r1s-btn" data-local="" aria-label={"More for " + name} aria-haspopup="menu"
                  onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(open?.key === key(acc) ? null : { at: { x: r.right - 200, y: r.bottom + 4 }, key: key(acc) }); }}>{MORE}</button>
              </span>
            </div>
          );
        })}
      </div>
    ) : !status.loading && !status.error ? <Line>No account yet. Add one, and Branch uses it for every Trunk.</Line> : null}
    {all.some((x) => !x.first) ? <Line>When one account runs low, Branch moves to the next.</Line> : null}
    {admin && all.length ? <Line>{admin}</Line> : null}
    <Failed text={failed} />
    {menu ? <div data-need={MENU_CALLS.join(" ")}><Menu at={menu.at} items={items(menu.acc)} onClose={() => setMenu(null)} label={accountName(menu.acc)} /></div> : null}
  </>;
}

/** The ⋯ menu's actions as their own rows (search finds them): pick an account, then Test it, Answer first or Sign out. */
type ActKind = "test" | "first" | "out";
const ACT: Record<ActKind, { label: string; call: string }> = {
  test: { label: "Test it", call: "models.probe" }, first: { label: "Answer first", call: "models.authOrderSet" }, out: { label: "Sign out", call: "models.authLogout" },
};
function AccountAction({ engine, kind }: SlotControlProps & { kind: ActKind }) {
  const { status, agent, all } = useAccounts(engine);
  const [failed, run] = useFailure();
  const [done, setDone] = useState("");
  const [picked, setPicked] = useState("");
  const acc = all.find((x) => key(x) === picked) ?? all[0];
  const why = adminWhy(engine) ?? (!acc ? "Add an account first." : undefined) ?? (kind === "first" && acc ? answerFirstWhy(acc) : kind === "out" && acc ? signOutWhy(acc.a) : undefined);
  const go = () => {
    if (!acc) return;
    setDone("");
    void run(async () => {
      if (kind === "test") { await testAccount(engine, acc, agent); setDone(accountName(acc) + " answered."); return; }
      if (kind === "first") await saveOrder(engine, acc.p, firstOrder(acc, all), agent); else await signOut(engine, acc, agent);
      await status.reload();
    });
  };
  return <>
    <span className="r1s-own-ctl">
      <select className="r1s-inp" aria-label={ACT[kind].label + ": account"} data-local="" value={acc ? key(acc) : ""} disabled={!all.length} onChange={(e) => { setPicked(e.target.value); setDone(""); }}>
        {all.length ? all.map((x) => <option key={key(x)} value={key(x)}>{accountName(x)}</option>) : <option value="">No account yet</option>}
      </select>
      <Needs engine={engine} need={[ACT[kind].call]} where={ACT[kind].label}>
        <button type="button" className="r1s-btn" disabled={Boolean(why)} title={why} onClick={go}>{ACT[kind].label}</button>
      </Needs>
    </span>
    {done ? <Line>{done}</Line> : null}
    <Failed text={failed} />
  </>;
}
export const TestIt = (p: SlotControlProps) => <AccountAction {...p} kind="test" />;
export const AnswerFirst = (p: SlotControlProps) => <AccountAction {...p} kind="first" />;
export const SignOut = (p: SlotControlProps) => <AccountAction {...p} kind="out" />;

/** The calls adding an account makes: the services (models.authStatus, branch.setup.detect), each service's sign-in
 *  (models.authLogin, or a key with models.authSetApiKey) and where it goes in the order (models.authOrderSet). */
export const ADD_CALLS = ["models.authStatus", "branch.setup.detect", "models.authLogin", "models.authSetApiKey", "models.authOrderSet"];

/** Add an account, Another X account and Sign in to X: Classic's add-account dialog. It also opens when another part of
 *  the window asks (sessionStorage "branch.openAddAccount" and the "branch:open-add-account" event, such as the
 *  composer's settings/accounts/add). */
export function AddAccount({ engine }: SlotControlProps) {
  const { status, agent, providers, caps, all } = useAccounts(engine);
  const [failed, , report] = useFailure();
  const [add, setAdd] = useState<AddStart | null>(null);
  useEffect(() => {
    const consume = () => { const asked = takeAddRequest(); if (asked) setAdd(asked); };
    window.addEventListener("branch:open-add-account", consume);
    consume();
    return () => window.removeEventListener("branch:open-add-account", consume);
  }, []);
  const ready = !status.loading && !status.error;
  const need = ["models.authStatus", "models.authLogin"];
  const admin = adminWhy(engine);
  return <Kit report={report}>
    <div className="r1s-acts">
      <Needs engine={engine} need={need} where="Add an account">
        <button type="button" className="r1s-btn" data-solid="" disabled={Boolean(admin)} title={admin} onClick={() => setAdd({})}>Add an account</button>
      </Needs>
      {anotherOffers(all).map((p) => {
        const name = "Another " + serviceName(p.provider, p.displayName) + " account";
        return <Needs key={p.provider} engine={engine} need={need} where={name}><button type="button" className="r1s-btn" disabled={Boolean(admin)} title={admin} onClick={() => setAdd({ provider: p.provider })}>{name}</button></Needs>;
      })}
      {ready ? signInOffers(caps, providers).map((id) => (
        <Needs key={id} engine={engine} need={need} where={"Sign in to " + serviceName(id)}>
          <button type="button" className="r1s-btn" disabled={Boolean(admin)} title={admin} onClick={() => setAdd({ provider: id })}>Sign in to {serviceName(id)}</button>
        </Needs>
      )) : null}
    </div>
    <Failed text={failed} />
    {add ? <AddAccountDialog clear engine={engine} start={add} caps={caps} providers={providers} agent={agent} onClose={(added) => { setAdd(null); if (added) void status.reload(); }} /> : null}
  </Kit>;
}

/** Select accounts (Advanced): tick accounts, then move them to the top or sign out of them, as Classic's bulk bar. */
export function SelectAccounts({ engine }: SlotControlProps) {
  const { status, agent, all } = useAccounts(engine);
  const [failed, run] = useFailure();
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = all.filter((acc) => picked?.includes(key(acc)));
  const locked = chosen.some((acc) => acc.p.profileOrderLocked);
  const leaving = chosen.filter((acc) => acc.a.logoutSupported);
  const admin = adminWhy(engine);
  const act = (work: () => Promise<void>) => void run(async () => { await work(); await status.reload(); }).then((ok) => { if (ok) setPicked(null); });
  return <>
    <span className="r1s-own-ctl">
      <button type="button" className="r1s-btn" data-local="" aria-pressed={picked !== null} disabled={!all.length} title={all.length ? undefined : "Add an account first."}
        onClick={() => setPicked(picked === null ? [] : null)}>{picked === null ? "Select accounts" : "Done selecting"}</button>
    </span>
    {picked !== null ? <>
      <div className="r1s-items">
        {all.map((acc) => (
          <label key={key(acc)} className="r1s-item">
            <input type="checkbox" data-local="" aria-label={"Select " + accountName(acc)} checked={picked.includes(key(acc))}
              onChange={(e) => setPicked(e.target.checked ? [...picked, key(acc)] : picked.filter((k) => k !== key(acc)))} />
            <span className="r1s-item-t g-label"><b>{accountName(acc)}</b></span>
          </label>
        ))}
      </div>
      <div className="r1s-acts" role="toolbar" aria-label="With the selected accounts">
        <Val>{chosen.length ? chosen.length + " selected" : "Tick the accounts"}</Val>
        <Needs engine={engine} need={["models.authOrderSet"]} where="Move to the top">
          <button type="button" className="r1s-btn" disabled={Boolean(admin) || !chosen.length || locked} title={admin ?? (locked ? "The order is set in the settings file." : undefined)} onClick={() => act(() => moveToTop(engine, all, chosen, agent))}>Move to the top</button>
        </Needs>
        <button type="button" className="r1s-btn" disabled title={PAUSE_OFF}>Pause</button>
        <Needs engine={engine} need={["models.authLogout"]} where="Sign out of the selected accounts">
          <button type="button" className="r1s-btn" disabled={Boolean(admin) || !leaving.length} title={admin ?? (chosen.length && !leaving.length ? "These sign-ins can’t be removed from here." : undefined)} onClick={() => act(() => signOutAll(engine, chosen, agent))}>Sign out</button>
        </Needs>
      </div>
    </> : null}
    <Failed text={failed} />
  </>;
}

/** The window's config (config.get), saved with config.patch, shared with every Settings row. */
function useConfigSnap(engine: WindowEngine) {
  const store = configStore(engine);
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const snap = useSyncExternalStore(subscribe, () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  return { store, snap, config: record(snap?.config) };
}

/** Fall back to this computer: adds this computer's model to agents.defaults.model.fallbacks, as Classic's switch. */
export function FallBackHere({ engine }: SlotControlProps) {
  const { store, snap, config } = useConfigSnap(engine);
  const models = useRead(engine, "models.list", { includeDetails: true });
  const [failed, run] = useFailure();
  const local = list(models.data?.models).find((m) => m.local === true);
  const ref = local ? text(local.provider) + "/" + text(local.id) : "";
  const raw = record(record(record(config.agents).defaults).model).fallbacks;
  const fallbacks = Array.isArray(raw) ? raw.map(String) : [];
  const on = Boolean(ref) && fallbacks.includes(ref);
  return <>
    <Needs engine={engine} need={["models.list", "config.patch"]} where="Fall back to this computer">
      <span className="r1s-own-ctl" title={adminWhy(engine)}>
        <Toggle label="Fall back to this computer" on={on} disabled={Boolean(adminWhy(engine)) || !local || !snap} onChange={(v) => void run(() => store.set("agents.defaults.model.fallbacks", v ? [...fallbacks, ref] : fallbacks.filter((f) => f !== ref)))} />
      </span>
    </Needs>
    <Line>{local ? "When every account is out, keep going on " + visible(local.name ?? local.id) + " instead of stopping." : models.loading ? "Looking for a model on this computer…" : "Needs a model on this computer first."}</Line>
    <Failed text={failed} />
  </>;
}

const NEXT_OPTIONS = [{ v: "order", label: "In order" }, { v: "turns", label: "Take turns" }];

/** Which account goes next (Technical): per service, an explicit order or taking turns (models.authOrderSet). */
export function WhichNext({ engine }: SlotControlProps) {
  const { status, agent, providers } = useAccounts(engine);
  const [failed, run] = useFailure();
  const many = providers.filter((p) => p.profiles.length > 0);
  return <>
    {many.length ? (
      <div className="r1s-items">
        {many.map((p) => {
          const name = serviceName(p.provider, p.displayName);
          return (
            <div key={p.provider} className="r1s-item">
              <Logo id={p.provider} size={22} />
              <span className="r1s-item-t g-label" data-lines><b>{name}</b><small>{nextSub(p)}</small></span>
              <Needs engine={engine} need={["models.authOrderSet"]} where={"Which " + name + " account goes next"}>
                <span className="r1s-own-ctl" title={adminWhy(engine)}>
                  <Segmented label={"Which " + name + " account goes next"} value={nextModeOf(p)} options={NEXT_OPTIONS} disabled={Boolean(adminWhy(engine) || p.profileOrderLocked)}
                    onChange={(m) => void run(async () => { await setNextMode(engine, p, String(m), agent); await status.reload(); })} />
                </span>
              </Needs>
            </div>
          );
        })}
      </div>
    ) : <Line>{status.loading ? "Reading your accounts…" : "No account yet."}</Line>}
    <Line>At random and Least used: Branch has no setting for these yet.</Line>
    <Failed text={failed} />
  </>;
}

/** Where each sign-in comes from (Technical): browser sign-ins, keys, and where a key is read from, per service. */
export function SignInSources({ engine }: SlotControlProps) {
  const { status, providers } = useAccounts(engine);
  if (!providers.length) return <Line>{status.loading ? "Reading your accounts…" : "No service set up yet."}</Line>;
  return <div className="r1s-items">
    {providers.map((p) => (
      <div key={p.provider} className="r1s-item">
        <Logo id={p.provider} size={22} />
        <span className="r1s-item-t g-label" data-lines><b>{serviceName(p.provider, p.displayName)}</b><small>{sourceLine(p)}</small></span>
      </div>
    ))}
  </div>;
}

/** Resting now (Advanced): accounts benched after a limit. */
export function RestingNow({ engine }: SlotControlProps) {
  const { status, all } = useAccounts(engine);
  const resting = restingOf(all);
  if (status.loading && !status.data) return <Val>Reading…</Val>;
  return resting.length ? <span className="r1s-acts">{resting.map((a) => <Val key={key(a)}>{accountName(a)}</Val>)}</span> : <Val>None</Val>;
}

/** One Trunk's account: anyone's, or one account it uses first (that Trunk's own order). */
function TrunkAccount({ engine, trunk }: { engine: WindowEngine; trunk: RecordValue }) {
  const id = text(trunk.id);
  const status = useRead(engine, "models.authStatus", { agentId: id });
  const [failed, run] = useFailure();
  const providers: Provider[] = providersOf(status.data?.providers);
  const { options, value } = trunkChoices(providers);
  const name = visible(record(trunk.identity).name ?? trunk.name ?? id);
  return <div className="r1s-item">
    <span className="r1s-item-t g-label"><b>{name}</b></span>
    <Needs engine={engine} need={["models.authStatus", "models.authOrderSet"]} where={name + ": account"}>
      <select className="r1s-inp" aria-label={name + ": account"} value={value} disabled={status.loading || Boolean(adminWhy(engine))} title={adminWhy(engine)} onChange={(e) => { const v = e.target.value; void run(async () => { await setTrunkAccount(engine, id, providers, v); await status.reload(); }); }}>
        <option value="">Anyone’s</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </div>;
}

/** Which account each Trunk uses (Advanced): one row per Trunk (agents.list). */
export function EachTrunkAccount({ engine }: SlotControlProps) {
  const trunks = useRead(engine, "agents.list");
  const agents = list(trunks.data?.agents);
  if (!agents.length) return <Line bad={Boolean(trunks.error)}>{trunks.error ? visible(trunks.error) : trunks.loading ? "Reading your Trunks…" : "No Trunk yet."}</Line>;
  return <div className="r1s-items">{agents.map((t) => <TrunkAccount key={text(t.id)} engine={engine} trunk={t} />)}</div>;
}

/** Fallback keys (Advanced): keys are added in Sign-ins & keys. */
export function FallbackKeys({ onPage }: SlotControlProps) {
  return <button type="button" className="r1s-btn" data-local="" disabled={!onPage} onClick={() => onPage?.("signins")}>Add a key</button>;
}

/** Your own accounts: the ones this person's new conversations use first, each with Stop using. */
export function OwnAccountList({ engine }: SlotControlProps) {
  const own = useRead(engine, "users.listModelAccounts");
  const [failed, run] = useFailure();
  const mine = list(own.data?.accounts).filter((a) => a.selected === true);
  const stop = (a: RecordValue) => void run(async () => { await engine.request("users.unlinkAuthProfile", { profileId: own.data?.profileId, authProfileId: a.authProfileId }); await own.reload(); });
  return <>
    {own.error ? <Line bad>{visible(own.error)}</Line> : null}
    {mine.length ? (
      <div className="r1s-items">
        {mine.map((a) => (
          <div key={text(a.authProfileId)} className="r1s-item">
            <Logo id={text(a.provider)} size={28} />
            <span className="r1s-item-t g-label" data-lines><b>{serviceName(text(a.provider), undefined, a.authType === "api_key") + " · " + visible(a.label)}</b><small>New conversations you start use it first.</small></span>
            <Needs engine={engine} need={["users.unlinkAuthProfile"]} where="Stop using">
              <button type="button" className="r1s-btn" disabled={Boolean(writeWhy(engine))} title={writeWhy(engine)} onClick={() => stop(a)}>Stop using</button>
            </Needs>
          </div>
        ))}
      </div>
    ) : !own.loading && !own.error ? <Line>No account of your own yet. New conversations use the household’s.</Line> : own.loading ? <Line>Reading your accounts…</Line> : null}
    <Failed text={failed} />
  </>;
}

/** Add your own account: Classic's picker of the accounts this person can use first (users.selectModelAccount). */
export function AddOwnAccount({ engine }: SlotControlProps) {
  const own = useRead(engine, "users.listModelAccounts");
  const [failed, , report] = useFailure();
  const [adding, setAdding] = useState(false);
  const accounts = list(own.data?.accounts);
  return <Kit report={report}>
    <Needs engine={engine} need={["users.listModelAccounts", "users.selectModelAccount"]} where="Add your own account">
      <button type="button" className="r1s-btn" disabled={Boolean(writeWhy(engine)) || own.loading || Boolean(own.error) || !accounts.length} title={writeWhy(engine) ?? (!own.loading && !accounts.length ? "Add an account above first." : undefined)} onClick={() => setAdding(true)}>Add your own account</button>
    </Needs>
    <Failed text={failed} />
    {adding ? <PickOwn engine={engine} accounts={accounts.filter((a) => a.selected !== true)} onClose={(picked) => { setAdding(false); if (picked) void own.reload(); }} /> : null}
  </Kit>;
}

/** A coding app on this computer as branch.setup.detect finds it; Codex's switch is plugins.entries.codex.enabled, the
 *  others follow their own sign-in (a greyed switch, as Classic). Claude Code shows its account from usage.status. */
function CodingApp({ engine, app }: SlotControlProps & { app: App }) {
  // §4.7.8: the switch reads on only when the app is ready, and is greyed until it is (preview's codingSecPE18).
  const detect = useRead(engine, "branch.setup.detect");
  const usage = useRead(engine, "usage.status");
  const { store, snap, config } = useConfigSnap(engine);
  const [failed, run] = useFailure();
  const f = foundState(app, detect.data);
  const word = detect.loading ? "Looking…" : PILL[f.state][1];
  const claude = list(usage.data?.providers).find((row) => row.provider === "claude-code");
  const pluginOn = app.plugin ? record(record(record(config.plugins).entries)[app.plugin]).enabled === true : f.state === "ready";
  const sub = detect.loading ? "Looking on this computer…" : appSub(app, f, pluginOn);
  return <>
    <div className="r1s-item">
      <Logo id={app.brand} size={22} />
      <span className="r1s-item-t g-label" data-lines>
        <b>{word}{app.kind === "claude-cli" && claude?.accountEmail ? " · " + text(claude.accountEmail) : ""}</b>
        <small>{detect.error ? visible(detect.error) : sub}</small>
      </span>
      {app.plugin ? (
        <Needs engine={engine} need={["config.patch"]} where={"Use " + app.name}>
          <span className="r1s-own-ctl" title={adminWhy(engine)}><Toggle label={"Use " + app.name} on={f.state === "ready" && pluginOn} disabled={Boolean(adminWhy(engine)) || !snap || f.state !== "ready"} onChange={(v) => void run(() => store.set("plugins.entries." + app.plugin + ".enabled", v))} /></span>
        </Needs>
      ) : (
        <span className="r1s-own-ctl" title={"Follows " + app.name + "’s own sign-in on this computer."}><Toggle label={"Use " + app.name} on={pluginOn} disabled onChange={() => undefined} /></span>
      )}
    </div>
    <Failed text={failed} />
  </>;
}
const appOf = (kind: string): App => APPS.find((a) => a.kind === kind) ?? APPS[0];
export const ClaudeCode = (p: SlotControlProps) => <CodingApp {...p} app={appOf("claude-cli")} />;
export const Codex = (p: SlotControlProps) => <CodingApp {...p} app={appOf("codex-cli")} />;
export const GeminiCli = (p: SlotControlProps) => <CodingApp {...p} app={appOf("gemini-cli")} />;

/** Check again: looks for the coding apps on this computer again (branch.setup.detect). */
export function CheckApps({ engine }: SlotControlProps) {
  const detect = useRead(engine, "branch.setup.detect");
  return <Needs engine={engine} need={["branch.setup.detect"]} where="Check again">
    <button type="button" className="r1s-btn" disabled={detect.loading || Boolean(adminWhy(engine))} title={adminWhy(engine)} onClick={() => void detect.reload()}>Check again</button>
  </Needs>;
}

// GitHub: one connection per window engine for the three rows (connect, permissions, expiry), as Classic's GitHub
// section for the shared account (tools.github.*). It ends when no row shows it, which cancels a sign-in in progress.
type Hub = { connection: GitHubConnection; subs: Set<() => void> };
const hubs = new WeakMap<WindowEngine, Hub>();
function hubOf(engine: WindowEngine, agentId: string): Hub {
  const had = hubs.get(engine);
  if (had) return had;
  const subs = new Set<() => void>();
  const hub: Hub = { subs, connection: new GitHubConnection(engine, agentId, "system", () => { for (const fn of [...subs]) fn(); }) };
  hubs.set(engine, hub);
  void hub.connection.refresh();
  return hub;
}
function useGitHub(engine: WindowEngine): { connection: GitHubConnection | null; view: GitHubView | null } {
  const [, redraw] = useState(0);
  const [hub, setHub] = useState<Hub | null>(null);
  useEffect(() => {
    if (!engine.agentId) return;
    const h = hubOf(engine, engine.agentId);
    const fn = () => redraw((n) => n + 1);
    h.subs.add(fn);
    setHub(h);
    return () => {
      h.subs.delete(fn);
      if (!h.subs.size) { h.connection.dispose(); hubs.delete(engine); }
    };
  }, [engine]);
  const view = hub?.connection.view ?? null;
  const status = view?.status;
  useEffect(() => { if (status) void configStore(engine).load(); }, [engine, status]);
  return { connection: hub?.connection ?? null, view };
}

/** GitHub: the shared account's connection, with Connect or Change account, Cancel sign-in, Use computer's account and
 *  Refresh, and the device code to enter on GitHub while signing in. */
export function GitHubRow({ engine }: SlotControlProps) {
  const { connection, view } = useGitHub(engine);
  if (!engine.agentId) return <Line>Select a Trunk to read its GitHub connection.</Line>;
  const identity = view?.status?.selected.identity;
  const admin = (engine.scopes ?? []).includes("operator.admin");
  const loading = !view || view.phase === "loading";
  const sub = identity ? (identity.source === "agent-override" ? "This Trunk’s account" : identity.source === "system-configured" ? "Shared account" : "This computer’s account") + " · " + (identity.credentialKind === "managed-oauth" ? "GitHub sign-in" : identity.credentialKind === "managed-pat" ? "Managed token" : "Native sign-in") : loading ? "Reading connection…" : "Connect GitHub or refresh to try again.";
  const state = identity ? identity.credentialState.replaceAll("_", " ") : loading ? "Checking" : "Not connected";
  const adminWhy = admin ? undefined : "Only someone who may change Branch’s setup can connect or remove a shared account.";
  return <>
    <div className="r1s-item">
      <Logo id="github-copilot" size={22} />
      <span className="r1s-item-t g-label" data-lines><b>{(identity?.account ? "@" + identity.account.login : "GitHub") + " · " + state}</b><small>{sub}</small></span>
      <span className="r1s-acts">
        {view?.busy ? (
          <Needs engine={engine} need={["tools.github.authorize.cancel"]} where="Cancel sign-in">
            <button type="button" className="r1s-btn" title={adminWhy} disabled={!admin || view.phase === "cancelling" || view.phase === "saving" || !connection} onClick={() => void connection?.cancel()}>{view.phase === "saving" ? "Saving…" : "Cancel sign-in"}</button>
          </Needs>
        ) : (
          <Needs engine={engine} need={["tools.github.authorize.start", "tools.github.authorize.poll"]} where="Connect GitHub">
            <button type="button" className="r1s-btn" data-solid="" title={adminWhy} disabled={!admin || !connection || loading} onClick={() => void connection?.start()}>{view?.status?.selected.configured ? "Change account" : "Connect GitHub"}</button>
          </Needs>
        )}
        {view?.status?.selected.configured ? (
          <Needs engine={engine} need={["tools.github.configure"]} where="Use computer’s account">
            <button type="button" className="r1s-btn" title={adminWhy} disabled={!admin || view.busy} onClick={() => void connection?.inherit()}>Use computer’s account</button>
          </Needs>
        ) : null}
        <Needs engine={engine} need={["tools.github.status"]} where="Refresh GitHub">
          <button type="button" className="r1s-btn" disabled={!connection || Boolean(view?.busy) || loading} onClick={() => void connection?.refresh()}>Refresh</button>
        </Needs>
      </span>
    </div>
    {view?.error ? <Line bad>{view.error}</Line> : null}
    {view?.device ? (
      <span className="r1s-item-t g-label" role="status" data-lines>
        <b>Enter <strong>{view.device.userCode}</strong> on GitHub.</b>
        <small><a href="https://github.com/login/device" target="_blank" rel="noopener noreferrer" data-local="">Open GitHub sign-in</a> · Code expires {new Date(view.expiresAt ?? 0).toLocaleTimeString()} · {view.phase.replaceAll("_", " ")}</small>
      </span>
    ) : null}
    {adminWhy ? <Line>{adminWhy}</Line> : null}
    <Line>Removing this connection retires its managed sign-in in Branch. To revoke access on GitHub, <a href="https://github.com/settings/applications" target="_blank" rel="noopener noreferrer" data-local="">manage authorized applications</a>.</Line>
  </>;
}

/** Permissions: the scopes of the GitHub connection. */
export function GitHubPermissions({ engine }: SlotControlProps) {
  const { view } = useGitHub(engine);
  const identity = view?.status?.selected.identity;
  if (!identity) return <Val>{!view || view.phase === "loading" ? "Reading…" : "Not connected"}</Val>;
  return <span className="r1s-item-t g-label" data-lines><b>{identity.oauthScopes.length ? identity.oauthScopes.join(", ") : "No scopes reported"}</b><small>Repository access is not reported</small></span>;
}

/** Access expires: when the GitHub connection's access ends, and its refresh state. */
export function GitHubExpires({ engine }: SlotControlProps) {
  const { view } = useGitHub(engine);
  const identity = view?.status?.selected.identity;
  if (!identity) return <Val>{!view || view.phase === "loading" ? "Reading…" : "Not connected"}</Val>;
  return <span className="r1s-item-t g-label" data-lines><b>{identity.accessExpiresAtMs === null ? "Not reported" : new Date(identity.accessExpiresAtMs).toLocaleString()}</b><small>Refresh: {identity.refreshState.replaceAll("_", " ")}</small></span>;
}

/** This Branch's identity (Technical): the engine's device id, shortened; the whole id is in the tooltip. */
export function BranchIdentity({ engine }: SlotControlProps) {
  const ident = useRead(engine, "gateway.identity.get");
  const id = typeof ident.data?.deviceId === "string" ? ident.data.deviceId : "";
  return id ? <Val title={id}><code>{shortId(id)}</code></Val> : <Val>{ident.loading ? "Reading…" : "Not reported"}</Val>;
}

/** Use a model from a hub for one run (Technical): the command, as Classic shows it. */
export const HubCommand = () => <Val><code>branch --model owner/package</code></Val>;

/** Each account keeps its own folder (Technical): always on, as Classic shows it. */
export const OwnFolder = () => <Val>Always on</Val>;

/* ---------- Usage by account (preview PG accounts) and the rows the preview draws as buttons ---------- */

const QUIET_REPORT = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

/** What Branch spent in the last 7, 30 or 90 days, and Open the report: Classic Data & usage's spend card. */
export function UsageSpend({ engine }: SlotControlProps) {
  const [level] = useLevel(engine);
  return <KitProvider level={level} report={QUIET_REPORT} scope={null}><AccountSpend engine={engine} level={level} /></KitProvider>;
}

/** What each account has left: Classic's allowance list, one row per connection and account. */
export function UsageList({ engine, onPage }: SlotControlProps) {
  return <KitProvider level={0} report={QUIET_REPORT} scope={null}><AccountAllowanceList engine={engine} openSettings={onPage ? (page) => onPage(pageFor(page)) : undefined} /></KitProvider>;
}

/** The ring bottom right: the status bar's ring, described; nothing to set. */
export function UsageRing(_: SlotControlProps) {
  return null;
}

/** Offer to save progress at 95%: the person's look key Classic saves (usage.ckpt), and Show me. */
export function SaveProgressOffer({ engine, row }: SlotControlProps) {
  const on = useCkptOn(engine);
  const look = useLook(engine);
  const [failed, run] = useFailure();
  const label = row.label ?? "Offer to save progress at 95%";
  return <>
    <span className="r1s-own-ctl">
      <button type="button" className="r1s-link" data-local="" onClick={() => window.dispatchEvent(new Event(CKPT_SHOW))}>Show me</button>
      <Needs engine={engine} need={look.snap.where === "device" ? [] : ["users.prefs.set"]} where={label}>
        <span className="r1s-own-ctl"><Toggle label={label} on={on} onChange={(v) => void run(() => lookStore(engine).set(CKPT_PREF, v))} /></span>
      </Needs>
    </span>
    <Failed text={failed} />
  </>;
}

/** A preview button with nothing behind it yet, Coming with its row's own reason. */
function comingButton(button: string): (props: SlotControlProps) => ReactNode {
  return function ComingButton({ engine, row }: SlotControlProps) {
    const src = row.source.kind === "slot" ? row.source : null;
    return <Coming engine={engine} need={src?.calls ?? []} unwired reason={src?.reason} where={row.label ?? button}><button type="button" className="r1s-btn">{button}</button></Coming>;
  };
}
export const LinkButton = comingButton("Link");
export const KeepOakConnect = comingButton("Connect your keepoak.com account");
