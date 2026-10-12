// Settings › Permissions (DESIGN-SPEC §4.7.11): what Trunks may do without asking. The mode for every conversation is
// tools.exec.mode (the engine key behind the composer's modes), the command defaults, rules and each Trunk's allowed
// commands are the exec approvals file (exec.approvals.get / .set with its base hash), approvals and standing
// permissions come from exec.approval.* and approval.history, and the sandbox and tool rows are config.patch keys.
// Whatever the engine has no key or method for is drawn greyed with the reason.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { list, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Acts, Btn, Hint, Page, useConfig, type RowEntry } from "../kit";
import { ApprovalsDialog } from "./permissions-approvals";
import { THIS_PC } from "./permissions-commands";
import { useApprovalsFile } from "./permissions-file";
import { SectionView, WHY, rowsOf, type Ctx, type Row, type Section } from "./permissions-rows";
import { LOWER } from "./permissions-sections";
import { LockdownStatus, ModeEverywhere, THIS_PC_ROWS, ThisPc } from "./permissions-top";
import "./set1.css";
import "./permissions.css";

const sw = (t: string, sub: string, on: boolean): Row => ({ k: "off", t, sub, c: { sw: on }, why: WHY.key });
const WITHOUT: Section = { title: "Without asking, Trunks may…", lv: 0, rows: [
  sw("Read files in Documents and Downloads", "Reading never changes a file.", true),
  sw("Use the browser on this computer", "Signs in with your saved sign-ins. You can take over any time.", true),
  sw("Send email and messages", "Off means every message waits for your yes.", true),
  sw("Install tools and packages", "Off means a request shows up in your Inbox.", false),
  sw("Record tasks so you can watch them again", "Recordings stay on this computer.", true),
] };

export function PermissionsPage(props: SettingsPageProps) {
  const cfg = useConfig(props.engine);
  const ap = useApprovalsFile(props.engine);
  const agents = useResource<RecordValue>(props.engine, "agents.list", {});
  const nodes = useResource<RecordValue>(props.engine, "node.list", {});
  const [rulesFor, setRulesFor] = useState(THIS_PC);
  const [approvals, setApprovals] = useState(false);
  const x: Ctx = {
    engine: props.engine, cfg, ap, openApprovals: () => setApprovals(true),
    trunks: list(agents.data?.agents), nodes: list(nodes.data?.nodes),
    rulesFor, setRulesFor, agents: agents.data, reloadAgents: agents.reload,
  };
  return (
    <Page title={props.title} lede="What Trunks may do without asking you first.">
      <LockdownStatus cfg={cfg} />
      <ThisPc />
      <ModeEverywhere cfg={cfg} agents={agents.data} reload={agents.reload} />
      <Hint>Full access does not turn on seeing the screen or using the mouse. That is a separate switch in Settings › Computer & browser › See the screen and use the mouse.</Hint>
      {props.openSettings ? (
        <Acts>
          <Btn sm onClick={() => props.openSettings?.("computer")}>Open that switch</Btn>
        </Acts>
      ) : null}
      <SectionView s={WITHOUT} x={x} />
      {LOWER.map((s) => <SectionView key={s.title} s={s} x={x} />)}
      {approvals ? <ApprovalsDialog engine={props.engine} onClose={() => setApprovals(false)} /> : null}
    </Page>
  );
}

const TOP: RowEntry[] = [
  ...THIS_PC_ROWS.map(([title]) => ({ page: "permissions", title, sec: "This computer", group: "This computer", lv: 0 as const })),
  { page: "permissions", title: "Lockdown", sec: "Locks and records", group: "Locks and records", lv: 0, words: "stop everything" },
  { page: "permissions", title: "Access", group: "Access", lv: 0, words: "auto ask first plan first read only full access mode screen mouse computer browser" },
];
const COMMAND_ROWS: RowEntry[] = ["Ask before a command", "When nobody can be asked", "Let skill programs run"].map((title) => ({ page: "permissions", title, sec: "Commands, by default", group: "Rules and checks", lv: 1 }));

export const PERMISSIONS_ROWS: RowEntry[] = [...TOP, ...rowsOf([WITHOUT, ...LOWER]), ...COMMAND_ROWS];
