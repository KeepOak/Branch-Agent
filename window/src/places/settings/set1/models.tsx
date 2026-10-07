// Settings › Models (DESIGN-SPEC §4.7.6): tabs Connections · Defaults · On this computer · Second opinion · Media,
// then the Advanced and Technical sections every tab shares. Every choice saves at once to the engine config
// (agents.defaults.*, or agents.entries.<Trunk>.* for "Settings for"); accounts are models.authStatus.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import type { RowEntry } from "../kit";
import { Btn, Hint, Page, Pill, Status, Tabs, useLevel, useSaveRunner } from "../kit";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import type { MenuAnchor } from "../../../shell/Menu";
import { Icon } from "../../../shell/icons";
import { AccountMenu, accountName, accountsOf, type Account } from "./accounts";
import { AddAccountDialog, type AddStart } from "./add-account";
import { Logo, serviceName } from "./service";
import { useModels, type ModelsCtx } from "./models-data";
import { DefaultsTab } from "./models-defaults";
import { LocalTab, MediaTab, SecondTab } from "./models-tabs";
import { ModelsSections } from "./models-more";
import { MODELS_ROWS as ROWS } from "./models-rows";

const TABS = [
  { id: "connections", label: "Connections" },
  { id: "defaults", label: "Defaults" },
  { id: "local", label: "On this computer" },
  { id: "second", label: "Second opinion" },
  { id: "media", label: "Media" },
];

export function ModelsPage(props: SettingsPageProps) {
  const m = useModels(props.engine);
  const lv = useLevel();
  const trunks = useResource<RecordValue>(props.engine, "agents.list", {});
  const scopeName = m.scope ? visible(record(list(trunks.data?.agents).find((t) => t.id === m.scope)?.identity).name ?? m.scope) : "";
  const [tab, setTab] = useState("connections");
  const [add, setAdd] = useState<AddStart | null>(null);
  return (
    <Page title={props.title} lede="Which models answer, and where they run.">
      {m.scope ? <p className="scope-line-k">{scopeName}’s own settings. Rows that apply to everyone are the same for every Trunk.</p> : null}
      <Tabs label="Models" tabs={TABS} value={tab} onChange={setTab} />
      {tab === "connections" ? <ConnectionsTab {...props} m={m} onAdd={setAdd} /> : null}
      {tab === "defaults" ? <DefaultsTab m={m} /> : null}
      {tab === "local" ? <LocalTab m={m} openSettings={props.openSettings} /> : null}
      {tab === "second" ? <SecondTab /> : null}
      {tab === "media" ? <MediaTab m={m} /> : null}
      {lv >= 1 ? <ModelsSections m={m} tab={tab} openSettings={props.openSettings} /> : null}
      {add ? <AddAccountDialog engine={props.engine} start={add} caps={(m.auth.data?.providerCapabilities ?? []) as never} providers={m.providers} agent={m.agent} onClose={(added) => { setAdd(null); if (added) { void m.auth.reload(); void m.catalog.reload(); } }} /> : null}
    </Page>
  );
}

type ConnProps = SettingsPageProps & { m: ModelsCtx; onAdd: (s: AddStart) => void };
function ConnectionsTab({ engine, m, onAdd }: ConnProps) {
  const save = useSaveRunner();
  const [menu, setMenu] = useState<{ at: MenuAnchor; acc: Account } | null>(null);
  const all = accountsOf(m.providers);
  const caps = (m.auth.data?.providerCapabilities ?? []) as { provider: string; loginOptions?: { featured?: boolean }[] }[];
  const unset = caps.filter((c) => !m.providers.some((p) => p.provider === c.provider && p.profiles.length) && c.loginOptions?.some((o) => o.featured));
  const setOrder = (acc: Account, ids: string[]) => save(async () => {
    await engine.request("models.authOrderSet", { provider: acc.p.authProvider ?? acc.p.provider, profileIds: ids, ...m.agent });
    await m.auth.reload();
  });
  if (m.auth.loading) return <Status tone="idle" title="Reading your connections…" />;
  if (m.auth.error) return <Status tone="bad" title="Branch couldn’t read your connections">{visible(m.auth.error)}</Status>;
  const groups = m.providers.filter((p) => p.profiles.length);
  const empty = !groups.length && !m.models.some((x) => x.local);
  return (
    <>
      <Hint>You can sign in to the same service more than once. When one account runs low, Branch moves to the next. The order is in Settings › Accounts.</Hint>
      {empty ? <Status tone="warn" title="No model set up" action={<Btn sm pri onClick={() => onAdd({})}>Add an account</Btn>}>Conversations need a model. Sign in to a service, add a key, or set one up on this computer.</Status> : null}
      <div className="acct-gs">
        {groups.map((p) => {
          const rows = all.filter((a) => a.p === p);
          const name = serviceName(p.provider, p.displayName);
          return (
            <div key={p.provider} className="acct-g">
              <div className="acct-gh"><Logo id={p.provider} size={30} /><b>{name}</b><span className="n6">{rows.length} {rows.length === 1 ? "account" : "accounts"}</span></div>
              {rows.map((acc) => (
                <div key={acc.a.profileId} className="acct-r">
                  <span className="grow"><b>{accountName(acc)}</b><small>{[p.usage?.plan ? `${visible(p.usage.plan)} plan` : "", acc.a.status === "ok" || acc.a.status === "static" ? "" : visible(acc.a.status)].filter(Boolean).join(" · ") || (acc.a.type === "api_key" ? "Key" : "Signed in")}</small></span>
                  {acc.ordered ? <Pill tone={acc.first ? "ok" : "idle"}>{acc.first ? "Answers first" : "Next in line"}</Pill> : <Pill tone="idle">Takes turns</Pill>}
                  <button type="button" className="icon-btn" aria-label={`More for ${accountName(acc)}`} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ at: { x: r.right - 200, y: r.bottom + 4 }, acc }); }}><Icon name="more" small /></button>
                </div>
              ))}
              <button type="button" className="add-row" onClick={() => onAdd({ provider: p.provider })}><Icon name="plus" small />Add another {name} account</button>
            </div>
          );
        })}
        {unset.map((c) => (
          <div key={c.provider} className="acct-g">
            <div className="acct-gh"><Logo id={c.provider} size={30} /><b>{serviceName(c.provider)}</b><span className="n6">Not set up</span></div>
            <button type="button" className="add-row" onClick={() => onAdd({ provider: c.provider })}><Icon name="plus" small />Sign in to {serviceName(c.provider)}</button>
          </div>
        ))}
      </div>
      {!empty ? <div className="acts"><Btn pri onClick={() => onAdd({})}><Icon name="plus" small />Add an account</Btn></div> : null}
      <div className="ctl find-k" data-row="Find models on this computer"><b>Find models on this computer</b><span className="right"><Btn sm onClick={() => onAdd({})}>Look</Btn></span></div>
      {menu ? <AccountMenu engine={engine} acc={menu.acc} all={all} at={menu.at} agent={m.agent} reload={m.auth.reload} setOrder={setOrder} onClose={() => setMenu(null)} /> : null}
    </>
  );
}

export const MODELS_ROWS: RowEntry[] = ROWS;
