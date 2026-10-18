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
import { SectionView, rowsOf, type Ctx } from "./permissions-rows";
import { LOWER } from "./permissions-sections";
import { LockdownStatus, ModeEverywhere, THIS_PC_ROWS, ThisPc } from "./permissions-top";
import "./set1.css";
import "./permissions.css";

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

export const PERMISSIONS_ROWS: RowEntry[] = [...TOP, ...rowsOf(LOWER), ...COMMAND_ROWS];
