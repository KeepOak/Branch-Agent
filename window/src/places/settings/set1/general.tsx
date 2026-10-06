// Settings › General (DESIGN-SPEC §4.7.1): how Branch starts, your projects, keys, writing, the conversation, summaries
// of older turns and the waiting line. Saves at once: engine rows through config.patch (messages.queue.*,
// agents.defaults.compaction.*, agents.defaults.contextPruning.*), the person's own rows through users.prefs.set,
// projects from projects.list. Rows only the desktop app or the OS could change are greyed with why.
import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { list, record, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Icon } from "../../../shell/icons";
import { ShortcutsDialog } from "../../../shell/ShortcutsDialog";
import { Btn, Ctl, Empty, Page, Plist, Prow, Sec, Status, Switch, useConfig, useLevel, usePinsKit, type Lv, type RowEntry } from "../kit";
import { PinnedSection } from "../pins";
import { useDesktopControls } from "../../../connect/desktop-controls";
import { ClipboardHistory, Controllers, CoverScreen, ThisComputer, Writing, OS } from "./general-more";
import { Conversation } from "./general-conversation";
import { OlderTurns, SummariesMore, SummariesTechnical, WaitingLine } from "./general-summaries";
import "./general.css";

export function GeneralPage(props: SettingsPageProps) {
  const lv = useLevel();
  const pins = usePinsKit();
  return (
    <Page title={props.title} lede="How Branch starts and behaves on this computer." top={<PinnedSection pins={pins} />}>
      <GeneralStatus engine={props.engine} />
      <StartingUp />
      <Projects engine={props.engine} />
      <Keyboard />
      <Writing engine={props.engine} />
      {lv >= 1 ? <ClipboardHistory /> : null}
      <CoverScreen />
      {lv >= 1 ? <><Controllers /><Conversation engine={props.engine} /><OlderTurns engine={props.engine} /></> : null}
      {lv >= 2 ? <SummariesTechnical engine={props.engine} /> : null}
      {lv >= 1 ? <ThisComputer /> : null}
      {lv >= 2 ? <><WaitingLine engine={props.engine} /><SummariesMore /></> : null}
    </Page>
  );
}

/** The Branch desktop app hides its window to the tray on close and keeps the engine running. */
export function staysInTray(): boolean {
  const w = window as { branchDesktop?: unknown };
  return Boolean(w.branchDesktop);
}

/** What starting up and closing the window do, as the Branch app on this computer has them. */
function GeneralStatus({ engine }: { engine: SettingsPageProps["engine"] }) {
  const cfg = useConfig(engine);
  const desk = useDesktopControls();
  if (cfg.loading) return <Status tone="idle" title="Reading Branch’s settings…" />;
  if (cfg.error) return <Status tone="bad" title="Branch couldn’t read its settings">{visible(cfg.error)}</Status>;
  if (desk.state && !desk.state.keepWorking) return <Status tone="idle" title="Branch runs while it’s open">Closing the window quits Branch and stops its engine.</Status>;
  if (staysInTray()) return <Status title="Branch waits in the tray">Closing the window keeps it running, so scheduled work goes on.</Status>;
  return <Status tone="idle" title="Branch runs while it’s open">Starting with {OS} and working on after the window closes are set in the Branch app on your computer.</Status>;
}

function StartingUp() {
  const desk = useDesktopControls();
  const why = desk.off;
  return (
    <Sec title="Starting up">
      <Ctl title={`Start with ${OS}`} sub="Opens quietly in the tray." off={why}>
        <Switch checked={desk.state?.startWithWindows ?? false} disabled={desk.busy !== null} label={`Start with ${OS}`} onChange={(on) => void desk.set("startWithWindows", on)} />
      </Ctl>
      <Ctl title="Keep working when the window closes" sub="Trunks finish what they started." off={why}>
        <Switch checked={desk.state?.keepWorking ?? false} disabled={desk.busy !== null} label="Keep working when the window closes" onChange={(on) => void desk.set("keepWorking", on)} />
      </Ctl>
      {desk.state && desk.error ? <small className="why-k" role="alert">{visible(desk.error)}</small> : null}
    </Sec>
  );
}

type Project = { id: string; displayName: string; source?: string };
function Projects({ engine }: { engine: SettingsPageProps["engine"] }) {
  const res = useResource<RecordValue>(engine, "projects.list", {});
  const projects = list(res.data?.projects) as unknown as Project[];
  return (
    <Sec title="Projects">
      {res.loading ? <p className="hint">Reading your projects…</p>
        : res.error ? <p className="hint">{visible(res.error)}</p>
        : projects.length ? <Plist>{projects.map((p) => <ProjectRow key={p.id} engine={engine} project={p} />)}</Plist>
        : <Empty>No projects yet.</Empty>}
    </Sec>
  );
}

function ProjectRow({ engine, project }: { engine: SettingsPageProps["engine"]; project: Project }) {
  const res = useResource<RecordValue>(engine, "sessions.list", { projectId: project.id, limit: 1, excludeSubagents: true, excludeCron: true });
  const total = record(res.data).totalCount;
  const sub = typeof total === "number" ? `${total} ${total === 1 ? "conversation" : "conversations"}` : res.loading ? "Counting conversations…" : "";
  return (
    <Prow icon={<span className="ico-tile gen-k"><Icon name="folder" small /></span>} title={visible(project.displayName)} sub={sub || undefined}>
      <Btn sm disabled title="Branch can’t open a project’s own instructions from here yet.">Edit</Btn>
    </Prow>
  );
}

function Keyboard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Sec title="Keyboard">
        <Ctl title="Keyboard shortcuts" sub="Ctrl K to find anything, Ctrl N for a new conversation.">
          <Btn sm onClick={() => setOpen(true)}>Show all</Btn>
        </Ctl>
      </Sec>
      {open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const rows = (sec: string, lv: Lv, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "general", title, sec, lv }));
export const GENERAL_ROWS: RowEntry[] = [
  ...rows("Starting up", 0, [`Start with ${OS}`, "Keep working when the window closes"]),
  ...rows("Projects", 0, []),
  ...rows("Keyboard", 0, ["Keyboard shortcuts"]),
  ...rows("Writing", 0, ["Message box grows with the text", "Check spelling in the message box", "Suggest the rest as I type", "Add my location to messages", "Replies in", "After a plan", "Open Branch on", "Show “Finish setting up”"]),
  ...rows("Writing", 1, ["Write long messages in your own editor", "Rounds before it checks in"]),
  ...rows("Clipboard history", 1, ["Keep after restart"]),
  ...rows("Cover the screen", 0, ["Cover now"]),
  ...rows("Controllers", 1, ["Use a gamepad or macro pad"]),
  ...rows("The conversation", 1, ["Vim keys in the message box", "Message times", "When you send while it works", "Send with", "Task progress above the message box", "Task progress starts", "Open past sessions in", "Ask before deleting a conversation"]),
  ...rows("Summaries of older turns", 1, ["Summarise older turns by themselves", "Summarise when the room left is under", "Always keep the latest", "Model for summaries"]),
  ...rows("Summaries, technical", 2, ["Room to plan for", "Repair the history before each call", "How it summarises", "Summary time limit", "Keep names and numbers exact", "Trim old tool results", "Trim after"]),
  ...rows(OS === "macOS" ? "This Mac" : "This PC", 1, ["Quick ask from anywhere", "Quick ask shortcut"]),
  ...rows("Waiting line", 2, ["Wait before sending what’s in line", "Most messages in line", "When the line is full"]),
  ...rows("Summaries, more", 2, ["How to write the summary", "If a summary can’t be made", "Keep the originals of what it summarises", "A receipt for each thing left out"]),
];
