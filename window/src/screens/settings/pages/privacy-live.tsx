// Settings › Privacy & data: Classic's own sections inside the R1 cards (spec-rows ClassicBlock), each on the same engine
// calls the Classic page used.
import type { SettingsPageProps } from "../../../places/settings/index";
import { list } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { useConfig, useScope } from "../../../places/settings/kit";
import { SHARING_MORE } from "../../../places/settings/set2/advanced";
import { Section } from "../../../places/settings/set2/advanced-more";
import { lvOf, rec, useLive, type RecordValue } from "../../../places/settings/set2/common";
import { ReportProblem } from "../../../places/settings/set2/report-problem";
import { DatabaseTechnical, Storage } from "../../../places/settings/set2/self";
import {
  ALL, EverySetting, Flagged, Keeping, KeepingMore, LOCAL, MoneyMore, MovingInOut, TrunkSpend, YourData, useNames,
} from "../../../places/settings/set2/usage";
import { ModelPrices } from "../../../places/settings/set2/usage-prices";
import type { SlotControlProps } from "../slots";
import { ClassicBlock } from "./spec-rows";

/** Advanced's "Sharing, more", with the context its rows read. */
function SharingMore({ props }: { props: SettingsPageProps }) {
  const config = useConfig(props.engine);
  const agent = useScope() ?? props.engine.agentId ?? "";
  const plugins = useLive<RecordValue>(props.engine, "plugins.list", {}, ["plugins"]);
  return <Section spec={SHARING_MORE} c={{ ...props, config, lv: lvOf(props.level), agent, plugins: list(rec(plugins.data).plugins) }} />;
}
function ConversationStorage({ props }: { props: SettingsPageProps }) {
  const config = useConfig(props.engine);
  const lv = lvOf(props.level);
  return <><Storage {...props} config={config} lv={lv} />{lv >= 2 ? <DatabaseTechnical /> : null}</>;
}
/** Spend by Trunk, last 30 days (Classic Data & usage's card, kept here; see the PR's notes for GOD). */
function SpendByTrunk({ props }: { props: SettingsPageProps }) {
  const names = useNames(props.engine);
  const spend = useResource<RecordValue>(props.engine, "sessions.usage", { range: "30d", ...ALL, ...LOCAL, limit: 1 });
  return <TrunkSpend spend={spend} names={names} days="30" />;
}

export const YourDataCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <><YourData engine={c.engine} />{c.lv >= 1 ? <SharingMore props={c.props} /> : null}</>} />;
export const KeepingCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <><Keeping engine={c.engine} lv={c.lv} />{c.lv >= 1 ? <KeepingMore engine={c.engine} lv={c.lv} /> : null}</>} />;
export const ConversationsCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <>{c.lv >= 2 ? <EverySetting engine={c.engine} /> : null}<ConversationStorage props={c.props} /></>} />;
export const MovingCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <MovingInOut engine={c.engine} lv={c.lv} />} />;
export const FlaggedCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <><Flagged lv={c.lv} /><ReportProblem /></>} />;
export const MoneyCard = (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <><MoneyMore engine={c.engine} lv={c.lv} /><SpendByTrunk props={c.props} /><ModelPrices engine={c.engine} /></>} />;
