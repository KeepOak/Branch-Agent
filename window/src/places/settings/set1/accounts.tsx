// Settings › Accounts (DESIGN-SPEC §4.7.8): the model accounts in the order Branch uses them, coding apps on this
// computer, what happens when one runs out, your own accounts and keepoak.com. Saves at once through the engine:
// order models.authOrderSet, sign-out models.authLogout, test models.probe, fallbacks config.patch.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Menu, type MenuAnchor, type MenuItem } from "../../../shell/Menu";
import { Icon } from "../../../shell/icons";
import { Acts, Btn, Ctl, Empty, Hint, Page, Pill, Plist, Prow, Sec, Status, Switch, useConfig, useLevel, useSaveRunner, useScope } from "../kit";
import { Logo, serviceName } from "./service";
import { AddAccountDialog, type AddStart } from "./add-account";
import { CodingApps } from "./coding-apps";
import { OwnAccounts } from "./own-accounts";
import { GitHubSettings } from "../GitHubSettings";
import { AccountsMore } from "./accounts-more";
import { BulkBar, SelectBox, SelectLink } from "./accounts-select";
import "./set1.css";

export type Profile = { profileId: string; type: string; status: string; displayName?: string; email?: string; lastUsedAt?: number; logoutSupported?: boolean; source?: string; reasonCode?: string; externallyManaged?: boolean; expiry?: { label?: string }; limitedUntil?: number };
export type Provider = { provider: string; authProvider?: string; displayName: string; status: string; profiles: Profile[]; profileOrder?: string[]; lastGoodProfileId?: string; profileOrderLocked?: string; usage?: { plan?: string; accountEmail?: string; windows?: Array<{ label?: string; usedPercent?: number }> } };
/** models.authStatus providers, each with its accounts as a list even when the engine leaves them out. */
export function providersOf(value: unknown): Provider[] {
  return list(value).map((p) => ({ ...p, profiles: list(p.profiles) }) as unknown as Provider);
}
export type Account = { p: Provider; a: Profile; n: number; first: boolean; last: boolean; ordered: boolean; next: boolean };

/** An account that hit its rate or usage limit and isn't used until `limitedUntil`. */
export const isLimited = (a: Pick<Profile, "limitedUntil">, now = Date.now()) => typeof a.limitedUntil === "number" && a.limitedUntil > now;

/** "Sat 2:00 AM": when a limited account comes back. */
export function limitedLabel(until: number): string {
  return `Limited until ${new Date(until).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

const UP = <svg className="i s" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const MORE = <svg className="i s" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="6" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18" cy="12" r="1.4" fill="currentColor" /></svg>;

/** Each provider's accounts in the engine's order (explicit order first, the rest after), one list across providers. */
export function accountsOf(providers: Provider[]): Account[] {
  return providers.flatMap((p) => {
    const order = p.profileOrder ?? [];
    const rank = (a: Profile) => { const i = order.indexOf(a.profileId); return i < 0 ? order.length : i; };
    const sorted = [...p.profiles].sort((x, y) => rank(x) - rank(y));
    // The engine skips a limited account until its reset, so "used next" is the first one that isn't limited.
    const next = sorted.find((a) => !isLimited(a));
    return sorted.map((a, i) => ({ p, a, n: i + 1, first: i === 0, last: i === sorted.length - 1, ordered: order.length > 0, next: a === next }));
  });
}

/** A pasted subscription token (Claude's `claude setup-token`): engine profile type "token". */
const isToken = (a: Pick<Profile, "type">) => a.type === "token";

/** A token account's own name, the label in its id ("anthropic:claude-2" is "claude-2"), as a ChatGPT account shows
 *  its email. Setup's generated "setup-<id>" and the engine's "default" are not names. */
export function tokenLabel(a: Pick<Profile, "profileId" | "type">): string | undefined {
  if (!isToken(a)) return undefined;
  const name = a.profileId.slice(a.profileId.indexOf(":") + 1);
  return name && name !== "default" && !name.startsWith("setup-") && !/^id-[a-f0-9]{12}$/.test(name) ? name : undefined;
}

export function accountName({ p, a, n }: Pick<Account, "p" | "a" | "n">): string {
  const svc = serviceName(p.provider, p.displayName, a.type === "api_key");
  const fallback = a.type === "api_key" ? `Key ${n}` : `Account ${n}`;
  return `${svc} · ${p.provider === "anthropic" ? a.email ?? a.displayName ?? tokenLabel(a) ?? fallback : a.displayName ?? a.email ?? tokenLabel(a) ?? fallback}`;
}

export const STATUS_WORDS: Record<string, string> = { ok: "", expiring: "Signing in again soon", expired: "Signed out · sign in again", missing: "Sign-in missing", static: "" };
function accountSub(acc: Account): string {
  const plan = acc.p.usage?.plan ? visible(acc.p.usage.plan) : acc.a.type === "api_key" ? "Key" : isToken(acc.a) ? "Subscription" : "";
  const email = acc.a.email && acc.a.displayName && acc.a.email !== acc.a.displayName ? visible(acc.a.email) : "";
  const state = STATUS_WORDS[acc.a.status] ?? visible(acc.a.status);
  return [plan, email, state, acc.ordered && acc.first ? "" : acc.ordered ? "next in line" : ""].filter(Boolean).join(" · ");
}

/** The order with this account moved up one place within its provider. */
export function movedUp(acc: Account, all: Account[]): string[] {
  const ids = all.filter((x) => x.p === acc.p).map((x) => x.a.profileId);
  const i = ids.indexOf(acc.a.profileId);
  if (i > 0) [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
  return ids;
}

export function AccountsPage(props: SettingsPageProps) {
  const scope = useScope();
  // As in Models: with several Trunks the engine needs an owner, so the household view uses the default Trunk.
  const owner = scope || props.engine.agentId;
  const agent = owner ? { agentId: owner } : {};
  const status = useResource<RecordValue>(props.engine, "models.authStatus", agent);
  const [add, setAdd] = useState<AddStart | null>(() => {
    if (sessionStorage.getItem("branch.openAddAccount") !== "1") return null;
    sessionStorage.removeItem("branch.openAddAccount");
    return {};
  });
  const providers = providersOf(status.data?.providers);
  const caps = list(status.data?.providerCapabilities);
  const all = accountsOf(providers);
  return (
    <Page title={props.title} lede="Manage model accounts and the order Branch uses them." help="Your model accounts, the order Branch uses them in, which Trunks use each, and your keepoak.com account.">
      <AccountsStatus loading={status.loading} error={status.error} count={all.length} unavailable={record(status.data?.unavailable).message} />
      <OrderSection {...props} all={all} reload={status.reload} onAdd={setAdd} agent={agent} />
      <CodingApps engine={props.engine} />
      <WhenOneRunsOut engine={props.engine} />
      <OwnAccounts engine={props.engine} />
      <GitHubSettings engine={props.engine} />
      <KeepOak />
      <AccountsMore engine={props.engine} providers={providers} all={all} reload={status.reload} agent={agent} openSettings={props.openSettings} />
      {add ? <AddAccountDialog engine={props.engine} start={add} caps={caps} providers={providers} agent={agent} onClose={(added) => { setAdd(null); if (added) void status.reload(); }} /> : null}
    </Page>
  );
}

function AccountsStatus({ loading, error, count, unavailable }: { loading: boolean; error?: string; count: number; unavailable?: unknown }) {
  if (loading) return <Status tone="idle" title="Reading your accounts…" />;
  if (error) return <Status tone="bad" title="Branch couldn’t read your accounts">{visible(error)}</Status>;
  if (unavailable) return <Status tone="warn" title="Account health isn’t ready yet">{visible(unavailable)}</Status>;
  if (!count) return <Status tone="idle" title="No account signed in">Add an account so your Trunks have a model to answer with.</Status>;
  return <Status title={`${count} ${count === 1 ? "account" : "accounts"} signed in`}>Branch never sees your passwords. Each account is billed by its own site.</Status>;
}

type OrderProps = SettingsPageProps & { all: Account[]; reload: () => Promise<void>; onAdd: (s: AddStart) => void; agent: { agentId?: string } };
function OrderSection({ engine, all, reload, onAdd, agent }: OrderProps) {
  const save = useSaveRunner();
  const lv = useLevel();
  const [menu, setMenu] = useState<{ at: MenuAnchor; acc: Account } | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const setOrder = (acc: Account, ids: string[]) => save(async () => {
    await engine.request("models.authOrderSet", { provider: acc.p.authProvider ?? acc.p.provider, profileIds: ids, ...agent });
    await reload();
  });
  const brands = [...new Map(all.map((x) => [x.p.provider, x.p])).values()];
  const selecting = lv >= 1 && picked !== null;
  const right = lv >= 1 && all.length ? <SelectLink on={selecting} onToggle={() => setPicked(selecting ? null : [])} /> : undefined;
  return (
    <Sec title="Order Branch uses them in" right={right}>
      {selecting ? <BulkBar engine={engine} all={all} picked={picked ?? []} agent={agent} reload={reload} done={() => setPicked(null)} /> : null}
      {all.length ? (
        <Plist>
          {all.map((acc) => (
            <Prow key={`${acc.p.provider}/${acc.a.profileId}`} icon={<>{selecting ? <SelectBox acc={acc} name={accountName(acc)} picked={picked ?? []} onPick={setPicked} /> : null}<Logo id={acc.p.provider} size={32} /></>} title={accountName(acc)} sub={accountSub(acc)}>
              {acc.ordered && acc.next ? <Pill tone="ok">used next</Pill> : null}
              {isLimited(acc.a) ? <Pill tone="warn">{limitedLabel(acc.a.limitedUntil ?? 0)}</Pill> : null}
              {acc.a.status === "expired" || acc.a.status === "missing" ? <Pill tone="warn">Sign in again</Pill> : null}
              <button type="button" className="icon-btn" aria-label="Move up" title={acc.first ? `First for ${serviceName(acc.p.provider, acc.p.displayName)} already` : acc.p.profileOrderLocked ? "The order is set in the settings file" : "Move up"} disabled={acc.first || Boolean(acc.p.profileOrderLocked)} onClick={() => void setOrder(acc, movedUp(acc, all))}>{UP}</button>
              <button type="button" className="icon-btn" aria-label={`More for ${accountName(acc)}`} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ at: { x: r.right - 200, y: r.bottom + 4 }, acc }); }}>{MORE}</button>
            </Prow>
          ))}
        </Plist>
      ) : <Empty>No account yet. Add one, and Branch uses it for every Trunk.</Empty>}
      {all.some((x) => !x.first) ? <Hint>When one account runs low, Branch moves to the next.</Hint> : null}
      <Acts>
        <Btn pri onClick={() => onAdd({})}><Icon name="plus" small />Add an account</Btn>
        <Btn onClick={() => onAdd({ provider: "anthropic" })}>Add a Claude account</Btn>
        {brands.filter((p) => p.provider !== "anthropic").map((p) => <Btn key={p.provider} onClick={() => onAdd({ provider: p.provider })}>Another {serviceName(p.provider, p.displayName)} account</Btn>)}
      </Acts>
      {menu ? <AccountMenu engine={engine} acc={menu.acc} all={all} at={menu.at} agent={agent} reload={reload} setOrder={setOrder} onClose={() => setMenu(null)} /> : null}
    </Sec>
  );
}

export type MenuProps = { engine: SettingsPageProps["engine"]; acc: Account; all: Account[]; at: MenuAnchor; agent: { agentId?: string }; reload: () => Promise<void>; setOrder: (a: Account, ids: string[]) => Promise<boolean>; onClose: () => void };
export function AccountMenu({ engine, acc, all, at, agent, reload, setOrder, onClose }: MenuProps) {
  const save = useSaveRunner();
  const provider = acc.p.authProvider ?? acc.p.provider;
  const ids = all.filter((x) => x.p === acc.p).map((x) => x.a.profileId);
  const outWhy = acc.a.logoutSupported ? undefined : acc.a.source === "config" ? "This sign-in is set in the settings file." : acc.a.source === "external" || acc.a.externallyManaged ? "Its own app keeps this sign-in; sign out there." : "This sign-in can’t be removed from here.";
  const items: MenuItem[] = [
    { label: "Test it", run: () => void save(async () => { const r = record(await engine.request("models.probe", { provider, profileId: acc.a.profileId, ...agent })); if (r.ok === false || (r.status && r.status !== "ok")) throw new Error(visible(r.error ?? r.status ?? "The test didn’t pass.")); }) },
    { label: "Answer first", disabled: acc.first && acc.ordered ? "It answers first already." : acc.p.profileOrderLocked ? "The order is set in the settings file." : undefined, run: () => void setOrder(acc, [acc.a.profileId, ...ids.filter((id) => id !== acc.a.profileId)]) },
    { label: "Rename", disabled: "Branch can’t rename an account yet.", run: () => undefined },
    { label: "Which Trunks use it", disabled: "Every Trunk uses this account, in this order.", run: () => undefined },
    { kind: "sep" },
    { label: "Sign out", danger: true, disabled: outWhy, run: () => void save(async () => { await engine.request("models.authLogout", { provider, profileIds: [acc.a.profileId], ...agent }); await reload(); }) },
  ];
  return <Menu at={at} items={items} onClose={onClose} label={accountName(acc)} />;
}

/** When one runs out: the engine always moves to the next account; "Fall back to this computer" adds a local model to the fallbacks. */
function WhenOneRunsOut({ engine }: { engine: SettingsPageProps["engine"] }) {
  const cfg = useConfig(engine);
  const models = useResource<RecordValue>(engine, "models.list", { includeDetails: true });
  const local = list(models.data?.models).find((m) => m.local === true);
  const localRef = local ? `${text(local.provider)}/${text(local.id)}` : "";
  const fallbacks = (cfg.get("agents.defaults.model.fallbacks") as string[] | undefined) ?? [];
  const on = Boolean(localRef) && fallbacks.includes(localRef);
  return (
    <Sec title="When one runs out">
      <Ctl title="Move to the next account in the list" sub="Only switches between accounts you own and pay for." help="Only between accounts you own and pay for, within each provider’s terms. No account’s allowance is shared with another person.">
        <span title="Branch always moves on when an account runs out."><Switch checked label="Move to the next account in the list" disabled onChange={() => undefined} /></span>
      </Ctl>
      <Ctl title="Fall back to this computer" sub={local ? `When every account is out, keep going on ${visible(local.name ?? local.id)} instead of stopping.` : "Needs a model on this computer first."}>
        <Switch checked={on} label="Fall back to this computer" disabled={!local || cfg.loading} onChange={(v) => void cfg.set("agents.defaults.model.fallbacks", v ? [...fallbacks, localRef] : fallbacks.filter((f) => f !== localRef))} />
      </Ctl>
    </Sec>
  );
}

const KO_LINES = [
  "Your KeepOak computer joins the computer switcher, with its agents.",
  "Your theme, saved colours and season follow you between computers and keepoak.com.",
  "Your team workspace: members, shared Trunks and what they’re running.",
  "Conversations, memory and keys stay on each computer. Nothing else is shared.",
];
function KeepOak() {
  return (
    <Sec personal title="keepoak.com">
      <div className="ko-card-acc">
        <span className="ko-acc" aria-hidden="true" />
        <span className="grow"><b>Your keepoak.com account</b><small>Have a KeepOak computer or a team on keepoak.com? Connect it once.</small></span>
      </div>
      <ul className="ticks-acc">
        {KO_LINES.map((line) => <li key={line}><Icon name="check" small />{line}</li>)}
      </ul>
      <Acts><Btn pri disabled title="keepoak.com has no sign-in Branch can use yet.">Connect your keepoak.com account</Btn><Hint>keepoak.com has no sign-in Branch can use yet.</Hint></Acts>
    </Sec>
  );
}
