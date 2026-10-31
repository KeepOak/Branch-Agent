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
import { currentKeys, keyActions, onMac, readCustomKeys, shownInline } from "../../../shell/keymap";
import { Btn, Ctl, Empty, Page, Plist, Prow, Sec, Status, useLevel, usePinsKit, type Lv, type RowEntry } from "../kit";
import { PinnedSection } from "../pins";
import { showsInternals } from "../internals";
import { KEEP_SIGNED_OUT, START_AT_SIGN_IN, StartingUp, Writing } from "./general-more";
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

type Project = { id: string; displayName: string; source?: string };
/** Projects Branch made for each Trunk (source "workspace") sit in a folded group; the ones you added show first. */
const isMadeByBranch = (p: Project) => p.source === "workspace";
function Projects({ engine }: { engine: SettingsPageProps["engine"] }) {
  const res = useResource<RecordValue>(engine, "projects.list", {});
  const projects = list(res.data?.projects) as unknown as Project[];
  const added = projects.filter((p) => !isMadeByBranch(p));
  const made = projects.filter(isMadeByBranch);
  return (
    <Sec title="Projects">
      {res.loading ? <p className="hint">Reading your projects…</p>
        : res.error ? <Status tone="warn" title="Couldn’t read your projects just now." action={<Btn sm onClick={res.reload}>Try again</Btn>} />
        : projects.length ? (
          <>
            {added.length ? <Plist>{added.map((p) => <ProjectRow key={p.id} engine={engine} project={p} />)}</Plist> : null}
            {made.length ? (
              <details className="gen-folded">
                <summary>Folders Branch made for Trunks ({made.length})</summary>
                <Plist>{made.map((p) => <ProjectRow key={p.id} engine={engine} project={p} />)}</Plist>
              </details>
            ) : null}
          </>
        ) : <Empty>No projects yet.</Empty>}
    </Sec>
  );
}

/** A project's folder name as a person reads it: "sample-project" is "Sample project". Technical keeps the folder name. */
export function plainProjectName(name: string, technical: boolean): string {
  if (technical || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) return name;
  const words = name.replace(/-/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

/** A project's name and its conversation count; the count shows only once there is one to show. */
function ProjectRow({ engine, project }: { engine: SettingsPageProps["engine"]; project: Project }) {
  const technical = showsInternals(useLevel());
  const res = useResource<RecordValue>(engine, "sessions.list", { projectId: project.id, limit: 1, excludeSubagents: true, excludeCron: true });
  const total = record(res.data).totalCount;
  // A count of zero is not shown: the project's conversations are not always the ones this count reads.
  const sub = typeof total === "number" ? (total > 0 ? `${total} ${total === 1 ? "conversation" : "conversations"}` : "") : res.loading ? "Counting conversations…" : "";
  return <Prow icon={<span className="ico-tile gen-k"><Icon name="folder" small /></span>} title={plainProjectName(visible(project.displayName), technical)} sub={sub || undefined} />;
}

/** The two most-used shortcuts in a sentence, written the way the Show all dialog writes them on this computer. */
function keyboardSub(mac: boolean): string {
  const keys = currentKeys(keyActions(""), readCustomKeys());
  return `${shownInline(keys.palette, mac)} to find anything, ${shownInline(keys.newConversation, mac)} for a new conversation.`;
}

function Keyboard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Sec title="Keyboard">
        <Ctl title="Keyboard shortcuts" sub={keyboardSub(onMac())}>
          <Btn sm onClick={() => setOpen(true)}>Show all</Btn>
        </Ctl>
      </Sec>
      {open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const rows = (sec: string, lv: Lv, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "general", title, sec, group: sec, lv }));
export const GENERAL_ROWS: RowEntry[] = [
  ...rows("Starting up", 0, [START_AT_SIGN_IN, KEEP_SIGNED_OUT]),
  ...rows("Projects", 0, []),
  ...rows("Keyboard", 0, ["Keyboard shortcuts"]),
  ...rows("Writing", 0, ["Show “Finish setting up”"]),
  ...rows("The conversation", 1, ["Vim keys in the message box", "Message times", "When you send while it works", "Send with", "Task progress above the message box", "Task progress starts", "Ask before deleting a conversation"]),
  ...rows("Summaries", 1, ["Summarise older turns by themselves", "Always keep the latest", "Model for summaries"]),
  ...rows("Summaries", 2, ["How it summarises", "Summary time limit", "Keep names and numbers exact", "Trim old tool results", "Trim after"]),
  ...rows("Waiting line", 2, ["Most messages in line", "When the line is full"]),
];
