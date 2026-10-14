// Settings › Models: Classic's own sections inside the R1 cards (spec-rows ClassicBlock), each on the same engine calls
// and the same model context (useModels) the Classic page used.
import { useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../../../places/settings/index";
import { useConfig, useScope } from "../../../places/settings/kit";
import { list } from "../../../places/settings/adapter";
import { useModels, type ModelsCtx } from "../../../places/settings/set1/models-data";
import { DefaultsTab, FallbackLists, HowTrunksWork, NewConversations, Nicknames } from "../../../places/settings/set1/models-defaults";
import {
  Budgets, CompareModels, DecisionModels, FinishingWell, Mixtures, ModelJobs, PickingModels, PicturesVideoMusic, SmallerJobs,
} from "../../../places/settings/set1/models-more";
import { MediaMore, SecondMore } from "../../../places/settings/set1/models-tabs";
import { Attachments, ConnectionsTechnical, DecisionTechnical, EachModel, HelpersTechnical, HowTurnsRun, PerConnection, PerConnectionMore, Retries } from "../../../places/settings/set1/models-tech";
import { TRY } from "../../../places/settings/set2/advanced";
import { Section } from "../../../places/settings/set2/advanced-more";
import { lvOf, rec, useLive, type RecordValue } from "../../../places/settings/set2/common";
import { Evals, TestModel } from "../../../places/settings/set2/usage";
import type { Row } from "../rows";
import type { SlotControlProps, SlotPageProps } from "../slots";
import { AccountList, AddAccount } from "./accounts-live";
import { LocalBlock } from "../../../places/settings/set1/local";
import { MediaTab, SecondTab } from "../../../places/settings/set1/models-tabs";
import { ClassicBlock } from "./spec-rows";

function WithModels({ props, draw }: { props: SettingsPageProps; draw: (m: ModelsCtx) => ReactNode }) {
  const m = useModels(props.engine);
  return <>{draw(m)}</>;
}
const models = (draw: (m: ModelsCtx) => ReactNode) => (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <WithModels props={c.props} draw={draw} />} />;

export const Defaults = models((m) => <><DefaultsTab m={m} /><NewConversations m={m} /><FallbackLists m={m} /><HowTrunksWork /><PickingModels m={m} /><ModelJobs m={m} /><Nicknames m={m} /></>);
export const Smaller = models((m) => <SmallerJobs m={m} />);
export const Compare = models(() => <><CompareModels /><SecondTab /><SecondMore /></>);
export const Mix = models(() => <Mixtures />);
export const Decision = models((m) => <><DecisionModels m={m} /><DecisionTechnical /></>);
export const Media = models((m) => <><PicturesVideoMusic m={m} /><MediaTab m={m} /><MediaMore /></>);
export const Finishing = models(() => <FinishingWell />);
export const Budget = models((m) => <Budgets m={m} />);
export const RetriesCard = models((m) => <Retries m={m} />);
export const Connection = models((m) => <><PerConnection /><PerConnectionMore /><ConnectionsTechnical m={m} /></>);
export const Turns = models(() => <HowTurnsRun />);
export const AttachmentsCard = models((m) => <Attachments m={m} />);
export const Each = models((m) => <><EachModel m={m} /><HelpersTechnical m={m} /></>);

/** Testing models: Classic's test set and evals (greyed in Classic until Branch can run them). */
export const Testing = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <><TestModel /><Evals lv={c.lv} /></>} />;

/** Try early: Classic Advanced's section, with the context its rows read. */
function TryEarly({ props }: { props: SettingsPageProps }) {
  const config = useConfig(props.engine);
  const agent = useScope() ?? props.engine.agentId ?? "";
  const plugins = useLive<RecordValue>(props.engine, "plugins.list", {}, ["plugins"]);
  return <Section spec={TRY} c={{ ...props, config, lv: lvOf(props.level), agent, plugins: list(rec(plugins.data).plugins) }} />;
}
export const Try = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <TryEarly props={c.props} />} />;

/** The preview's lead above the cards: Connections, Defaults, On this computer, Second opinion and Media, as tabs. Each
 *  tab draws the block Classic Models drew for it; Connections lists the accounts with the R1 Accounts page's own list. */
const TABS = [["connections", "Connections"], ["defaults", "Defaults"], ["local", "On this computer"], ["second", "Second opinion"], ["media", "Media"]] as const;
const leadRow = (label: string): Row => ({ id: "models.lead", page: "models", card: "", label, level: 0, control: "custom", source: { kind: "slot", calls: [], reason: "" } } as Row);
export function ModelsLead({ engine, onPage }: SlotPageProps) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("connections");
  const p = { engine, onPage, row: leadRow(TABS.find(([id]) => id === tab)![1]) };
  return <>
    <div className="r1s-tabs" role="tablist" aria-label="Models">
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" data-local="" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    <div role="tabpanel" aria-label={p.row.label}>
      {tab === "connections" ? <>
        <p className="r1s-leadhint g-clear">You can sign in to the same service more than once. When one account runs low, Branch moves to the next. The order is in <button type="button" className="r1s-link" data-local="" onClick={() => onPage?.("accounts")}>Settings › Accounts</button>.</p>
        <AccountList {...p} /><AddAccount {...p} />
      </> : null}
      {tab === "defaults" ? models((m) => <DefaultsTab m={m} />)(p) : null}
      {tab === "local" ? <ClassicBlock {...p} draw={(c) => <LocalBlock {...c.props} part="hardware" />} /> : null}
      {tab === "second" ? <ClassicBlock {...p} draw={() => <SecondTab />} /> : null}
      {tab === "media" ? models((m) => <MediaTab m={m} />)(p) : null}
    </div>
  </>;
}
