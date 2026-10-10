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
import { Btn, Ctl, Empty, Page, Plist, Prow, Sec, Status, Switch, useLevel, usePinsKit, type Lv, type RowEntry } from "../kit";
import { PinnedSection } from "../pins";
import { NEEDS_NEWER_APP, useDesktopControls } from "../../../connect/desktop-controls";
import { OS, Writing } from "./general-more";
import { Conversation } from "./general-conversation";
import { OlderTurns, SummariesTechnical, WaitingLine } from "./general-summaries";
import "./general.css";

export function GeneralPage(props: SettingsPageProps) {
  const lv = useLevel();
  const pins = usePinsKit();
  return (
    <Page title={props.title} lede="How Branch starts and behaves on this computer." top={<PinnedSection pins={pins} />}>
      <StartingUp />
      <Projects engine={props.engine} />
      <Keyboard />
      <Writing engine={props.engine} />
      {lv >= 1 ? <><Conversation engine={props.engine} /><Sec title="Summaries">
        <OlderTurns engine={props.engine} grouped />
        {lv >= 2 ? <SummariesTechnical engine={props.engine} grouped /> : null}
      </Sec></> : null}
      {lv >= 2 ? <WaitingLine engine={props.engine} /> : null}
    </Page>
  );
}

/** Said under Start with … when the Branch app on this computer is too old to change it (DA-78): the app's own note is a
 *  developer note that is never shown, so a greyed switch would otherwise sit there with no reason. */
const START_NEEDS_UPDATE = "Update the Branch app on this computer to change this.";

function StartingUp() {
  const desk = useDesktopControls();
  const why = desk.off === NEEDS_NEWER_APP ? START_NEEDS_UPDATE : desk.off;
  const start = `Start with ${OS()}`;
  return (
    <Sec title="Starting up">
      <Ctl title={start} sub="Opens quietly in the tray." off={why}>
        <Switch checked={desk.state?.startWithWindows ?? false} disabled={desk.busy !== null} label={start} onChange={(on) => void desk.set("startWithWindows", on)} />
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
        : res.error ? <Status tone="warn" title="Couldn’t read your projects just now." action={<Btn sm onClick={res.reload}>Try again</Btn>} />
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

const rows = (sec: string, lv: Lv, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "general", title, sec, group: sec, lv }));
export const GENERAL_ROWS: RowEntry[] = [
  ...rows("Starting up", 0, [`Start with ${OS()}`]),
  ...rows("Projects", 0, []),
  ...rows("Keyboard", 0, ["Keyboard shortcuts"]),
  ...rows("Writing", 0, ["Show “Finish setting up”"]),
  ...rows("The conversation", 1, ["Vim keys in the message box", "Message times", "When you send while it works", "Send with", "Task progress above the message box", "Task progress starts", "Ask before deleting a conversation"]),
  ...rows("Summaries", 1, ["Summarise older turns by themselves", "Always keep the latest", "Model for summaries"]),
  ...rows("Summaries", 2, ["How it summarises", "Summary time limit", "Keep names and numbers exact", "Trim old tool results", "Trim after"]),
  ...rows("Waiting line", 2, ["Most messages in line", "When the line is full"]),
];
