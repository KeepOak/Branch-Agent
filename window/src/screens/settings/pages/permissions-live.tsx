// Settings › Permissions: Classic's own sections inside the R1 cards (spec-rows ClassicBlock), on the same engine calls
// the Classic page used: the exec approvals file, agents.list, node.list and config.patch keys.
import { useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../../../places/settings/index";
import { list, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { useConfig } from "../../../places/settings/kit";
import { WITHOUT } from "../../../places/settings/set1/permissions";
import { ApprovalsDialog } from "../../../places/settings/set1/permissions-approvals";
import { THIS_PC } from "../../../places/settings/set1/permissions-commands";
import { useApprovalsFile } from "../../../places/settings/set1/permissions-file";
import { SectionView, type Ctx, type Section } from "../../../places/settings/set1/permissions-rows";
import { LOWER } from "../../../places/settings/set1/permissions-sections";
import { LockdownStatus, ModeEverywhere, ThisPc } from "../../../places/settings/set1/permissions-top";
import type { SlotControlProps } from "../slots";
import { ClassicBlock } from "./spec-rows";
import "../../../places/settings/set1/permissions.css";

const sec = (title: string): Section => {
  const s = LOWER.find((x) => x.title === title);
  if (!s) throw new Error(`No Classic Permissions section "${title}".`);
  return s;
};

/** The context Classic's Permissions sections read, built as the Classic page built it. */
function WithCtx({ props, draw }: { props: SettingsPageProps; draw: (x: Ctx) => ReactNode }) {
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
  return <>{draw(x)}{approvals ? <ApprovalsDialog engine={props.engine} onClose={() => setApprovals(false)} /> : null}</>;
}
const perms = (draw: (x: Ctx) => ReactNode) => (p: SlotControlProps) => <ClassicBlock {...p} draw={(c) => <WithCtx props={c.props} draw={draw} />} />;
const secs = (...titles: (string | Section)[]) => perms((x) => <>{titles.map((t) => {
  const s = typeof t === "string" ? sec(t) : t;
  return <SectionView key={s.title} s={s} x={x} />;
})}</>);

export const Mode = perms((x) => <><ThisPc /><ModeEverywhere cfg={x.cfg} agents={x.agents} reload={x.reloadAgents} /></>);
export const Lockdown = perms((x) => <><LockdownStatus cfg={x.cfg} /><SectionView s={sec("Locks and records")} x={x} /></>);
export const Without = secs(WITHOUT, "Without asking, more");
export const Rules = secs("Rules for each tool and folder");
export const Commands = secs("Commands, by default", "Tools and loops");
export const Checks = secs("Checks before anything runs", "Test and explain");
export const Approvals = secs("Approvals, more");
export const Guards = secs("Guards that are always on", "Guards, more");
export const Money = secs("Money");
export const Connectors = secs("What each connector may do");
export const Isolation = secs("Isolation", "Folders the sandbox may reach", "Your terminal");
export const Network = secs("Network and sandbox, technical", "Security, technical", "Tools, technical");
export const Policy = secs("Company policy");
export const Privacy = secs("Pinned settings", "Privacy");
