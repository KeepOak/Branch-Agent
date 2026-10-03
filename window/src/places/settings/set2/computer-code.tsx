// Settings › Computer & browser: the code sections (Code … Code, technical). Separate copies and branches come
// from worktrees.*, commit credit from the person's users.prefs, the shell and copy settings from config; the
// rest are greyed with why until the engine has them.
import { useState } from "react";
import { Acts, Btn, Ctl, Switch } from "../kit";
import { list } from "../adapter";
import { Dialog } from "../../../shell/Dialog";
import { CallLine, rec, str, useCall, useLive, when, type RecordValue } from "./common";
import type { Ctx, SecSpec, Spec } from "./computer-more";

const NO_CODE = "Needs the engine’s coding options for this.";
const NO_KNOW = "Needs the engine to keep notes about a project.";
const NO_GIT = "Needs the engine’s git settings for this.";
const NO_CHECK = "Needs the engine to run this check before done.";
const NO_BIG = "Needs the engine’s planned coding workflows.";
const NO_SUGGEST = "Needs the engine’s edit suggestions.";
const NO_APPS = "Needs the engine to hand coding to other apps this way.";
const COAUTHOR = "git.coauthor.enabled";

const off = (k: Spec["k"], reason: string) => (t: string, extra: Partial<Spec> = {}): Spec => ({ t, k, off: reason, ...extra });

const CODE: SecSpec = { t: "Code", lv: 1, rows: [
  off("sw", "Needs the engine to try a plan on its own branch.")("Try ideas on a branch"),
  { t: "Separate copies", k: "custom", render: (c) => <Copies c={c} mode="copies" /> },
  { t: "Branches Branch is keeping", k: "custom", render: (c) => <Copies c={c} mode="branches" /> },
  off("sw", NO_CODE)("Code map"),
  off("sw", NO_CODE)("Check and format files after editing"),
  off("sw", NO_CODE)("AI! and AI? comments start tasks"),
  off("sw", NO_CODE)("Draft a pull request from a task"),
  { t: "Remember the shell", k: "sw", key: "env.shellEnv.enabled", def: false, sub: "Your login shell’s PATH and settings, so commands behave as in your terminal." },
  { t: "Credit you on commits", k: "custom", render: (c) => <Credit c={c} /> },
] };

const sw = (r: string) => (t: string) => off("sw", r)(t);
const CODE_MORE: SecSpec = { t: "Code, more", lv: 1, rows: [
  off("pick", NO_CODE)("How it writes edits", { opts: [{ v: "auto", l: "Picked for each model" }] }),
  off("pick", NO_CODE)("Model that writes the edits", { opts: [{ v: "same", l: "The same model" }] }),
  ...["Run the tests after each edit"].map(sw(NO_CODE)),
  off("text", NO_CODE)("Test command"), off("text", NO_CODE)("Lint commands"),
  ...["Run only the affected tests", "Ask before editing files outside the conversation", "Edit by function and class", "Copy .env files into new copies"].map(sw(NO_CODE)),
  off("text", NO_CODE)("Setup script for new copies"), off("text", NO_CODE)("Run script"),
  ...["Merge helpers’ copies back", "Fix errors it sees in previews", "Bring the running app’s errors in", "Let it see pages it makes"].map(sw(NO_CODE)),
  off("pick", NO_CODE)("Run code it writes", { opts: [{ v: "box", l: "In a sealed box" }] }),
  off("btn", "Needs the engine to export a Trunk to a repository.")("Share a Trunk through git", { btn: "Export…" }),
] };

const KNOWS: SecSpec = { t: "What it knows about a project", lv: 1, rows: [
  "Remember why", "Follow the project’s decisions", "Design rules for the project", "Keep docs in step with the code", "A wiki for each repository",
  "Read a library’s source at the version you use", "Note library changes since the model learned", "A coding buddy that watches the project",
].map(sw(NO_KNOW)) };

const GIT: SecSpec = { t: "Git", lv: 1, rows: [
  ...["Commit after each edit", "Save my own changes first", "Mark commits made by Branch", "Run the project’s commit checks"].map(sw(NO_GIT)),
  off("text", NO_GIT)("How commit messages are written"),
  off("pick", NO_GIT)("Commit message language", { opts: [{ v: "same", l: "Same as the conversation" }] }),
  ...["Only this folder of a large repository", "Offer to start a repository", "Offer to add Branch’s files to .gitignore", "Check the repository at start",
    "Tell the Trunk about the repository", "Push fixes for failing checks", "Block secrets in commits"].map(sw(NO_GIT)),
  off("text", NO_GIT)("After a patch is applied, run"), off("text", NO_GIT)("After a pull request opens, run"),
  ...["Pull request commands", "One issue per recurring finding", "Learn how this project reviews", "Review cards in chat apps", "Share changes as signed events",
    "Review verdicts move board cards", "GitHub notifications in Inbox"].map(sw(NO_GIT)),
] };

const CHECKS: SecSpec = { t: "Checks before done", lv: 1, rows: [
  "Check before saying done", "Review my work in the background", "A second Trunk checks the work", "Judge helpers’ work against the goal",
  "Check a change before it becomes a pull request", "Plugins may add checks", "Project rules as checks", "Only accept work that was pushed",
  "Don’t let it change tests to pass", "Prove each check can fail", "Security scan in reviews", "A model from another family reviews", "UI quality check",
  "Staged judging", "Extra security review for risky changes", "Test first", "Leftover check", "Look at the screens it builds", "Lessons become commit checks",
  "Blocks that change together", "New lines need tests",
].map(sw(NO_CHECK)) };

const BIG: SecSpec = { t: "Big coding tasks", lv: 1, rows: [
  sw(NO_BIG)("Interview me, then split into tickets"),
  off("pick", NO_BIG)("Work through issues from a tracker", { opts: [{ v: "off", l: "Off" }] }),
  ...["Stages from goal to pull request", "Find the likely bug first", "Build a backend step by step", "From an issue: failing test first", "Add found bugs to the spec"].map(sw(NO_BIG)),
  off("pick", NO_BIG)("A cheaper model writes, another checks", { opts: [{ v: "off", l: "Off" }] }),
  ...["Plan which app does each task", "Changes as proposals", "Build an app from a description", "Stages need evidence"].map(sw(NO_BIG)),
] };

const SUGGEST: SecSpec = { t: "Suggestions while you edit", lv: 1, rows: [
  sw(NO_SUGGEST)("Finish the line as you type"), sw(NO_SUGGEST)("Suggest the next edit"),
  off("pick", NO_SUGGEST)("Model for suggestions", { opts: [{ v: "auto", l: "A small, fast model" }] }),
  sw(NO_SUGGEST)("Use the whole project"),
] };

const APPS: SecSpec = { t: "Coding apps", lv: 1, rows: [
  { t: "Hand coding to another app", k: "pick", key: "acp.enabled", def: true, opts: [{ v: false, l: "Don’t hand it off" }, { v: true, l: "Hand it to a coding app" }], sub: "A coding app on this computer can take a coding task as a background helper." },
  ...["If one fails, try another", "Their questions come to Inbox", "Trust new copies for coding apps", "Install coding apps into Trunks’ computers",
    "Coding apps in cloud computers", "Run on another computer", "Let editors drive Branch", "Edits go through the editor"].map(sw(NO_APPS)),
  off("pick", "Where “Open in editor” goes is set by the Branch app.")("Your editor", { opts: [{ v: "code", l: "VS Code" }] }),
  off("btn", "The editor add-on is installed from the Branch app.")("Editor add-on", { btn: "Install" }),
  off("btn", NO_APPS)("Branch over your own shell", { btn: "Set up" }),
  sw(NO_APPS)("Disassembler bridge"),
] };

export const CODE_SECS: SecSpec[] = [CODE, CODE_MORE, KNOWS, GIT, CHECKS, BIG, SUGGEST, APPS];

export const CODE_TECH: SecSpec = { t: "Code, technical", lv: 2, rows: [
  off("code", NO_CODE)("Files Branch never reads", { code: ".branchignore" }),
  sw(NO_CODE)("Read a file before editing it"),
  sw(NO_CODE)("Keep large tool outputs"),
  off("btn", "Needs a published Branch CI setup.")("Branch in CI", { btn: "Copy the setup" }),
  { t: "Where copies live", k: "text", key: "worktreeRoot", ph: "Branch’s own folder", sub: "Applies to new copies only." },
  { t: "Fast copies", k: "sw", key: "worktreeAcceleration", def: true, sub: "Uses the disk’s own cloning (Btrfs, APFS or ReFS) when it can." },
  ...["Find edits that are slightly off", "Structural edits"].map(sw(NO_CODE)),
  off("pick", NO_CODE)("Code map size", { opts: [{ v: 1024, l: "1,024 tokens" }] }),
  off("pick", NO_CODE)("Refresh the code map", { opts: [{ v: "auto", l: "Automatically" }] }),
  ...["Install language helpers when needed", "Fast TypeScript check", "Fix common TypeScript errors without a model", "Try edits in memory first"].map(sw(NO_CODE)),
  off("btn", "Needs the engine to take checkpoints before each turn.")("Checkpoints", { btn: "Clean up now" }),
  sw("Needs the engine to take checkpoints before each turn.")("Very large projects: ask before checkpoints"),
  sw(NO_CODE)("Copies made ahead"),
  off("pick", NO_CODE)("Where conversations work", { opts: [{ v: "folder", l: "In the folder" }] }),
  ...["A full app stack per copy", "Open projects in their dev container"].map(sw(NO_CODE)),
  off("pick", NO_CODE)("Build on another computer", { opts: [{ v: "here", l: "This computer" }] }),
  sw(NO_CODE)("Projects in their own folder store"),
  sw("Needs the engine to let Branch edit its own files.")("Let Branch change its own code"),
] };

/** Separate copies (worktrees.*): see, restore, remove or clean them up. */
function Copies({ c, mode }: { c: Ctx; mode: "copies" | "branches" }) {
  const res = useLive<RecordValue>(c.engine, "worktrees.list", {}, ["worktrees"]);
  const [open, setOpen] = useState(false);
  const live = list(rec(res.data).worktrees).filter((w) => !w.removedAt);
  const title = mode === "copies" ? "Separate copies" : "Branches Branch is keeping";
  const sub = mode === "copies" ? "Each task that tries an idea gets its own copy of the repository. See, restore or clean them up." : "Separate copies of a repository that conversations work in.";
  return (
    <Ctl title={title} sub={res.error || sub}>
      <Btn sm disabled={!res.data} onClick={() => setOpen(true)}>{res.data ? (live.length ? `See ${live.length}` : "None yet") : "See"}</Btn>
      {open ? <CopiesDialog c={c} title={title} mode={mode} res={res} onClose={() => setOpen(false)} /> : null}
    </Ctl>
  );
}

const OWNER: Record<string, string> = { manual: "You", canopy: "Canopy", session: "Conversation" };
type Res = ReturnType<typeof useLive<RecordValue>>;

function CopiesDialog({ c, title, mode, res, onClose }: { c: Ctx; title: string; mode: string; res: Res; onClose: () => void }) {
  const call = useCall();
  const [removing, setRemoving] = useState<RecordValue | null>(null);
  const [repo, setRepo] = useState("");
  const rows = list(rec(res.data).worktrees).filter((w) => !w.removedAt || w.snapshotRef);
  const act = (method: string, params: unknown, note: (r: RecordValue) => string) => void call.run(async () => { const r = rec(await c.engine.request(method, params)); void res.reload(); return r; }, note);
  return (
    <Dialog title={title} wide onClose={onClose} footer={<Btn onClick={onClose}>Close</Btn>}>
      <Acts>
        <input className="inp" aria-label="Repository folder" placeholder="Repository folder" value={repo} onChange={(e) => setRepo(e.target.value)} />
        <Btn pri sm disabled={!repo.trim() || call.busy} onClick={() => act("worktrees.create", { repoRoot: repo.trim() }, () => "Made a new copy.")}>New copy</Btn>
        <Btn ghost sm disabled={call.busy} onClick={() => act("worktrees.gc", {}, (r) => `Cleaned up ${Array.isArray(r.removed) ? r.removed.length : 0} copies and ${Number(r.snapshotsPruned) || 0} snapshots.`)}>Clean up now</Btn>
      </Acts>
      <CallLine call={call} />
      {!rows.length ? <p className="hint">No separate copies yet.</p> : null}
      <div className="rows">
        {rows.map((w) => (
          <div key={str(w.id)} className="prow" data-row={str(w.name)}>
            <span className="grow">
              <b>{mode === "branches" ? str(w.branch) : str(w.name)}</b>
              <small>{[str(w.repoRoot), mode === "branches" ? str(w.name) : str(w.branch), OWNER[str(w.ownerKind)] ?? "", w.removedAt ? "Restorable" : `active ${when(w.lastActiveAt)}`].filter(Boolean).join(" · ")}</small>
            </span>
            {w.removedAt ? <Btn ghost sm disabled={call.busy} onClick={() => act("worktrees.restore", { id: str(w.id) }, () => `Restored ${str(w.name)}.`)}>Restore</Btn>
              : <Btn ghost sm onClick={() => setRemoving(w)}>Remove…</Btn>}
          </div>
        ))}
      </div>
      {removing ? <Confirm title={`Remove ${str(removing.name)}?`} body="Branch keeps a snapshot first, so you can restore it later." yes="Remove" danger
        onYes={async () => { await c.engine.request("worktrees.remove", { id: str(removing.id) }); void res.reload(); }} onClose={() => setRemoving(null)} /> : null}
    </Dialog>
  );
}

/** Credit you on commits: the person's own preference (users.prefs git.coauthor.enabled; absent means on). */
function Credit({ c }: { c: Ctx }) {
  const res = useLive<RecordValue>(c.engine, "users.prefs.get", { keys: [COAUTHOR] }, ["users.prefs"]);
  const call = useCall();
  const d = rec(res.data);
  const sub = "Adds your GitHub no-reply address as co-author on commits from shared conversations. Turning it off affects later commits only.";
  if (d.status === "no_durable_identity") return <Ctl title="Credit you on commits" off="Needs you signed in as a person on this Branch."><Switch label="Credit you on commits" checked={false} onChange={() => undefined} /></Ctl>;
  const value = rec(d.entries)[COAUTHOR];
  const on = value === undefined || value === true;
  const save = (v: boolean) => void call.run(async () => { await c.engine.request("users.prefs.set", { entries: { [COAUTHOR]: v } }); void res.reload(); });
  return (
    <Ctl title="Credit you on commits" sub={res.error || sub} after={<CallLine call={call} />}>
      <Switch label="Credit you on commits" checked={on} disabled={!res.data || call.busy} onChange={save} />
    </Ctl>
  );
}

/** A confirm dialog for an engine call started from a row (also used by computer-more.tsx). */
export function Confirm({ title, body, yes, danger, onYes, onClose }: { title: string; body: string; yes: string; danger?: boolean; onYes: () => Promise<unknown>; onClose: () => void }) {
  const call = useCall();
  const go = () => void call.run(async () => { await onYes(); onClose(); });
  return (
    <Dialog title={title} onClose={onClose} footer={<><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri={!danger} className={danger ? "bad" : undefined} disabled={call.busy} onClick={go}>{yes}</Btn></>}>
      <p>{body}</p>
      <CallLine call={call} />
    </Dialog>
  );
}

