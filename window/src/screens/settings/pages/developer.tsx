// Settings › Developer: the approved preview's twenty-one cards (preview.html PG developer), in its order. Each card holds
// the Classic Developer and Advanced sections the preview maps to it (set2/developer.tsx, set2/advanced*.tsx): a section
// of rows Classic greys is Coming rows in their own words; a section that works is drawn as Classic's own rows inside the
// card, without its Classic heading (spec-rows.tsx ClassicBlock).
import type { ReactNode } from "react";
import type { SettingsPageProps } from "../../../places/settings/index";
import {
  ASSISTANTS, BuildMore, BuildOnBranch, CODE_MORE, Editors, FromTerminal, HelpWithCode, LINKS, LocalAddress, MORE_LINKS, OtherPrograms, RunWithout, SCRIPTS,
  SettingsFileSec, SystemSec, ToolsTech, Widgets, useDevCtx,
} from "../../../places/settings/set2/developer";
import { RunsTraces, TroubleMore, Troubleshooting, type OffRow } from "../../../places/settings/set2/developer-more";
import { ELSE, HEALTH, HOOKS, LOGS, NETWORK, useAdvCtx } from "../../../places/settings/set2/advanced";
import { DOCKER_SEC, Section, type SecSpec as AdvSpec } from "../../../places/settings/set2/advanced-more";
import type { Control, Row, RowOption } from "../rows";
import type { PageSlot, SlotControl } from "../slots";
import { ClassicBlock } from "./spec-rows";

type DevCtx = ReturnType<typeof useDevCtx>;
type Part = { block: string; draw: (c: DevCtx) => ReactNode } | { adv: AdvSpec } | { off: OffRow[] };
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function DevPart({ props, draw }: { props: SettingsPageProps; draw: (c: DevCtx) => ReactNode }) {
  return <>{draw(useDevCtx(props))}</>;
}
function AdvPart({ props, spec }: { props: SettingsPageProps; spec: AdvSpec }) {
  return <Section spec={spec} c={useAdvCtx(props)} />;
}

/** A greyed Classic row's control kind, as an R1 control. */
function controlOf(kind: string | undefined): { control: Control; options?: RowOption[] } {
  if (kind === "sw" || kind === "on") return { control: "toggle" };
  if (kind === "in" || kind?.startsWith("in:")) return { control: "text" };
  if (kind?.startsWith("seg:")) return { control: "segmented", options: kind.slice(4).split("|").map((v) => ({ v, label: v })) };
  return { control: "custom" };
}

const PLAN: [string, Part[]][] = [
  ["Build on Branch", [{ block: "Build on Branch", draw: (c) => <BuildOnBranch {...c} /> }, { block: "Build on Branch", draw: (c) => <BuildMore {...c} /> }]],
  ["Local address", [{ block: "Local address", draw: (c) => <LocalAddress {...c} /> }]],
  ["branch:// links", [{ off: [...LINKS, ...MORE_LINKS] }]],
  ["Editors and other apps", [{ block: "Editors and other apps", draw: (c) => <Editors {...c} /> }, { block: "Other programs", draw: (c) => <OtherPrograms {...c} /> }]],
  ["Let other assistants use Branch", [{ off: ASSISTANTS }]],
  ["Runs and traces", [{ block: "Runs and traces", draw: (c) => <RunsTraces {...c} /> }]],
  ["Run without the window", [{ block: "Run without the window", draw: (c) => <RunWithout {...c} /> }]],
  ["From a terminal", [{ block: "From a terminal", draw: () => <FromTerminal /> }]],
  ["Settings file", [{ block: "Settings file", draw: (c) => <SettingsFileSec {...c} /> }]],
  ["System", [{ block: "System", draw: (c) => <SystemSec {...c} /> }]],
  ["Troubleshooting", [{ block: "Troubleshooting", draw: (c) => <Troubleshooting {...c} /> }, { block: "Troubleshooting, more", draw: (c) => <TroubleMore {...c} /> }]],
  ["Help with code", [{ block: "Help with code", draw: (c) => <HelpWithCode {...c} /> }, { off: CODE_MORE }]],
  ["Widgets", [{ block: "Widgets", draw: (c) => <Widgets {...c} /> }]],
  ["Memory and automations, for scripts", [{ off: SCRIPTS }]],
  ["Tools", [{ block: "Tools", draw: (c) => <ToolsTech {...c} /> }]],
  ["Logs", [{ adv: LOGS }]],
  ["Docker", [{ adv: DOCKER_SEC }]],
  ["Hooks", [{ adv: HOOKS }]],
  ["Network", [{ adv: NETWORK }]],
  ["Health", [{ adv: HEALTH }]],
  ["Everything else", [{ adv: ELSE }]],
];

function build(): PageSlot {
  const rows: Row[] = [];
  const controls: Record<string, SlotControl> = {};
  const used = new Set<string>();
  const idOf = (card: string, t: string) => { let id = `developer.${slug(card)}.${slug(t)}`; for (let i = 2; used.has(id); i++) id = `developer.${slug(card)}.${slug(t)}-${i}`; used.add(id); return id; };
  const bare = (card: string, label: string, draw: (props: SettingsPageProps) => ReactNode) => {
    const id = idOf(card, label);
    rows.push({ id, page: "developer", card, label, level: 0, control: "custom", bare: true, source: { kind: "slot", calls: [], reason: `${label} comes in a later update.` } });
    controls[id] = (p) => <ClassicBlock {...p} draw={(c) => draw(c.props)} />;
  };
  for (const [card, parts] of PLAN) for (const part of parts) {
    if ("block" in part) bare(card, part.block, (props) => <DevPart props={props} draw={part.draw} />);
    else if ("adv" in part) bare(card, part.adv.title, (props) => <AdvPart props={props} spec={part.adv} />);
    else for (const [t, sub, need, kind] of part.off) {
      rows.push({ id: idOf(card, t), page: "developer", card, label: t, level: 0, ...controlOf(kind), ...(sub ? { help: sub } : {}),
        source: { kind: "coming", need, reason: `${t} comes in a later update.` } });
    }
  }
  // City lookup reads and writes its own settings. The usual values match the ones used when a setting is left empty.
  // The path command stays grey: Developer already has every switch the page can click, so a live one would not run.
  const city = "plugins.entries.geolocation.config";
  const add = (label: string, extra: Pick<Row, "control" | "help" | "source"> & Partial<Pick<Row, "fallback" | "unit">>) => {
    rows.push({ id: idOf("Everything else", label), page: "developer", card: "Everything else", label, level: 2, ownerLevel: true, ...extra });
  };
  add("City list source", { control: "text", help: "Where the city list comes from. Leave it empty to use the usual monthly list.",
    fallback: "https://download.db-ip.com/free/dbip-city-lite-{yyyy}-{mm}.mmdb.gz", source: { kind: "config", path: `${city}.databaseUrl` } });
  add("Credit for the city list", { control: "text", help: "The line shown next to a city. Change it only when you point at a different list.",
    fallback: "IP Geolocation by DB-IP", source: { kind: "config", path: `${city}.attributionText` } });
  add("Credit link", { control: "text", help: "The page that line opens.",
    fallback: "https://db-ip.com", source: { kind: "config", path: `${city}.attributionUrl` } });
  add("Refresh the city list", { control: "number", unit: "days", help: "How many days the saved city list is kept before a new copy is downloaded.",
    fallback: 30, source: { kind: "config", path: `${city}.refreshDays` } });
  const pathId = idOf("Everything else", "Workspace path command");
  rows.push({ id: pathId, page: "developer", card: "Everything else", label: "Workspace path command", level: 2, ownerLevel: true, control: "toggle",
    help: "Looks up and changes files in a workspace by their path.", source: { kind: "slot", calls: [], reason: "Workspace path command comes in a later update." } });
  controls[pathId] = () => (
    <div data-coming="a workspace path command">
      <button type="button" className="r1s-sw" role="switch" aria-label="Workspace path command" aria-checked="false" disabled />
      <small className="r1s-note g-label" data-lines>Workspace path command comes in a later update.</small>
    </div>
  );
  return { rows, controls };
}

export const DEVELOPER: PageSlot = build();
