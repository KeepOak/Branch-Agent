// Settings › Computer & browser: the code sections (Code … Code, technical). Separate copies and branches come
// from worktrees.*, commit credit from the person's users.prefs, the shell and copy settings from config; the
// rest are greyed with why until the engine has them.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
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
  off("sw", "Needs the engine to try a plan on its own branch.")("Try ideas on a branch", { sub: "A plan can be tried, compared and merged; a forked conversation gets its own copy." }),
  { t: "Separate copies", k: "custom", render: (c) => <Copies c={c} mode="copies" /> },
  { t: "Branches Branch is keeping", k: "custom", render: (c) => <Copies c={c} mode="branches" /> },
  off("sw", NO_CODE)("Code map", { sub: "A ranked outline of a repository so a Trunk finds its way." }),
  off("sw", NO_CODE)("Check and format files after editing"),
  off("sw", NO_CODE)("AI! and AI? comments start tasks", { sub: "Write “AI! add tests” in a file and a Trunk picks it up. Off until you choose: it watches the files in your projects." }),
  off("sw", NO_CODE)("Draft a pull request from a task", { sub: "Branch merges it only when you turn on “Auto-merge when ready” for that pull request." }),
  { t: "Remember the shell", k: "sw", key: "env.shellEnv.enabled", def: false, sub: "Your login shell’s PATH and settings, so commands behave as in your terminal." },
  { t: "Credit you on commits", k: "custom", render: (c) => <Credit c={c} /> },
] };

const sw = (r: string) => (t: string, sub?: string) => off("sw", r)(t, { sub });
const CODE_MORE: SecSpec = { t: "Code, more", group: "Code", showHeading: false, lv: 1, rows: [
  off("pick", NO_CODE)("How it writes edits", { sub: "Picked for each model unless you choose. Slightly-off edits still find their place.", opts: [{ v: "auto", l: "Picked for each model" }] }),
  off("pick", NO_CODE)("Model that writes the edits", { sub: "In “Plan, then edit”, a second model turns the plan into edits.", opts: [{ v: "same", l: "The same model" }] }),
  sw(NO_CODE)("Run the tests after each edit", "Failures go back to the Trunk to fix."),
  off("text", NO_CODE)("Test command", { ph: "pnpm test", sub: "Found from the project when empty." }), off("text", NO_CODE)("Lint commands", { ph: "typescript: pnpm eslint --fix", sub: "Per language; a failure becomes a fix request." }),
  sw(NO_CODE)("Run only the affected tests", "Uses the code’s imports to pick the tests that cover a change."),
  sw(NO_CODE)("Ask before editing files outside the conversation", "New files and files not added to the conversation need your yes."),
  sw(NO_CODE)("Edit by function and class", "Replace or rename a whole function or class across the project, instead of by line."),
  sw(NO_CODE)("Copy .env files into new copies", "A separate copy gets the same local settings files."),
  off("text", NO_CODE)("Setup script for new copies", { ph: "pnpm install", sub: "Runs once in each new copy." }), off("text", NO_CODE)("Run script", { ph: "pnpm dev", sub: "How “Run the app” starts this project from a copy." }),
  sw(NO_CODE)("Merge Trunks’ copies back", "Finished Trunks’ work is merged in order; a clash goes back to that Trunk."),
  sw(NO_CODE)("Fix errors it sees in previews", "Errors in a preview’s console go back to the Trunk, which fixes them and reloads."),
  sw(NO_CODE)("Bring the running app’s errors in", "Errors, console output and screenshots from the app you are building reach the conversation."),
  sw(NO_CODE)("Let it see pages it makes", "It can turn its own HTML into a picture to check how it looks."),
  off("pick", NO_CODE)("Run code it writes", { sub: "Output and pictures stream into the conversation.", opts: [{ v: "box", l: "In a sealed box" }] }),
  off("btn", "Needs the engine to export and import a Trunk through a repository.")("Share a Trunk through git", { sub: "Export a Trunk to a repository, or bring one in from one.", btns: ["Export…", "Import…"] }),
] };

const KNOWS: SecSpec = { t: "What it knows about a project", lv: 1, rows: [
  sw(NO_KNOW)("Remember why", "Notes on why an approach was chosen, shown to it before it edits that code again."),
  sw(NO_KNOW)("Follow the project’s decisions", "Decision records in the repository are read before edits and their rules are checked."),
  sw(NO_KNOW)("Design rules for the project", "Palette, spacing and type choices kept as rules it follows."),
  sw(NO_KNOW)("Keep docs in step with the code", "Changed functions get their docs rewritten after each commit."),
  sw(NO_KNOW)("A wiki for each repository", "Linked notes on the code, each fact pointing at the source it came from. Shows in Library."),
  sw(NO_KNOW)("Read a library’s source at the version you use", "Fetches the version in your lockfile so it reads the real code."),
  sw(NO_KNOW)("Note library changes since the model learned", "Adds short notes to AGENTS.md about packages that changed after the model’s training."),
  sw(NO_KNOW)("A coding buddy that watches the project", "Notices failing checks, stale copies and drift, and suggests one thing at a time."),
] };

const GIT: SecSpec = { t: "Git", lv: 1, rows: [
  sw(NO_GIT)("Commit after each edit", "Only the files it changed, with a written message."),
  sw(NO_GIT)("Save my own changes first", "Your uncommitted changes to a file are committed on their own before it edits that file."),
  sw(NO_GIT)("Mark commits made by Branch", "Adds who made it to the commit, so history shows what came from Branch."),
  sw(NO_GIT)("Run the project’s commit checks", "Off: Branch’s commits skip the project’s pre-commit hooks."),
  off("text", NO_GIT)("How commit messages are written", { ph: "Built in", sub: "Your own instructions replace the built-in ones." }),
  off("pick", NO_GIT)("Commit message language", { sub: "Defaults to the conversation’s language.", opts: [{ v: "same", l: "Same as the conversation" }] }),
  sw(NO_GIT)("Only this folder of a large repository", "It sees and edits the folder it started in, not the whole repository."),
  sw(NO_GIT)("Offer to start a repository", "In a folder without git, it offers to make one first."),
  sw(NO_GIT)("Offer to add Branch’s files to .gitignore", "Also .env, so secrets stay out of commits."),
  sw(NO_GIT)("Check the repository at start", "A damaged repository is reported with how to repair it."),
  sw(NO_GIT)("Tell the Trunk about the repository", "The branch, its status and the latest commits go with each conversation."),
  sw(NO_GIT)("Push fixes for failing checks", "Fixes for a pull request’s checks and comments are committed and pushed."),
  sw(NO_GIT)("Block secrets in commits", "Added lines are scanned before a commit or push; one with a secret is stopped."),
  off("text", NO_GIT)("After a patch is applied, run", { ph: "command", sub: "Gets the full details as JSON." }), off("text", NO_GIT)("After a pull request opens, run", { ph: "command", sub: "Gets the full details as JSON." }),
  sw(NO_GIT)("Pull request commands", "Comment /describe, /improve or /ask on a pull request and Branch answers there."),
  sw(NO_GIT)("One issue per recurring finding", "Scheduled checks update their earlier issue instead of opening another."),
  sw(NO_GIT)("Learn how this project reviews", "Reviews follow what maintainers accepted or waved off before."),
  sw(NO_GIT)("Review cards in chat apps", "A change ready for review posts a card with its diff; it merges once approved."),
  sw(NO_GIT)("Share changes as signed events", "Each patch and its status, signed and linked to its repository."),
  sw(NO_GIT)("Review verdicts move board cards", "A pull request’s review result moves its card on the board."),
  sw(NO_GIT)("GitHub notifications in Inbox", "Unread notifications, ranked, read only."),
] };

const CHECKS: SecSpec = { t: "Checks before done", lv: 1, rows: [
  sw(NO_CHECK)("Check before saying done", "After editing, it must show fresh evidence (tests, a build) before it finishes."),
  sw(NO_CHECK)("Review my work in the background", "A separate Trunk reviews recent changes while this one carries on."),
  sw(NO_CHECK)("A second Trunk checks the work", "Read only: it runs the tests and reads the files, then says pass or fail."),
  sw(NO_CHECK)("Judge Trunks’ work against the goal", "A Trunk’s result is checked against the goal and what counts as done."),
  sw(NO_CHECK)("Check a change before it becomes a pull request", "Empty, huge or unrelated changes don’t become pull requests."),
  sw(NO_CHECK)("Plugins may add checks", "After code edits, plugins can ask for checks of their own."),
  sw(NO_CHECK)("Project rules as checks", "Structure and behaviour rules kept in the repository must pass before done."),
  sw(NO_CHECK)("Only accept work that was pushed", "A task closed with no real commit, and no note saying why, goes back."),
  sw(NO_CHECK)("Don’t let it change tests to pass", "While fixing failing checks, edits to test files are refused or flagged."),
  sw(NO_CHECK)("Prove each check can fail", "A check that can’t be made to fail is reported as untrusted, not green."),
  sw(NO_CHECK)("Security scan in reviews", "Changed code is scanned and the results go to the reviewer."),
  sw(NO_CHECK)("A model from another family reviews", "Another model checks the change against what was asked."),
  sw(NO_CHECK)("UI quality check", "Generated screens are scored for common tells and accessibility misses."),
  sw(NO_CHECK)("Staged judging", "Commands first, then the goal, then several models; gaming the checks is refused."),
  sw(NO_CHECK)("Extra security review for risky changes", "Anything touching sign-in, keys or the network gets a security pass first."),
  sw(NO_CHECK)("Test first", "Code without a failing test for it is blocked."),
  sw(NO_CHECK)("Leftover check", "Placeholder comments, debug prints and stale TODOs are flagged before review."),
  sw(NO_CHECK)("Look at the screens it builds", "Built screens are rendered and checked before the work is accepted."),
  sw(NO_CHECK)("Lessons become commit checks", "A lesson you teach it turns into a check that stops a bad commit."),
  sw(NO_CHECK)("Blocks that change together", "Tagged code and the docs or config it affects must change together."),
  sw(NO_CHECK)("New lines need tests", "A change whose new lines aren’t covered by tests doesn’t pass."),
] };

const BIG: SecSpec = { t: "Big coding tasks", lv: 1, rows: [
  sw(NO_BIG)("Interview me, then split into tickets", "For a big task it asks questions first, writes the plan and splits it into small tickets."),
  off("pick", NO_BIG)("Work through issues from a tracker", { sub: "Each ready issue gets its own copy and a run.", opts: [{ v: "off", l: "Off" }] }),
  sw(NO_BIG)("Stages from goal to pull request", "Research, design, a plan per phase and review gates before a pull request."),
  sw(NO_BIG)("Find the likely bug first", "Runs passing and failing tests to rank where the bug probably is."),
  sw(NO_BIG)("Build a backend step by step", "Requirements, database, API, tests, then code, each checked before the next."),
  sw(NO_BIG)("From an issue: failing test first", "Writes a test that fails, tries several fixes and keeps the one that passes."),
  sw(NO_BIG)("Add found bugs to the spec", "A bug found late becomes a new acceptance point and a test."),
  off("pick", NO_BIG)("A cheaper model writes, another checks", { sub: "The checker only sends back what is still wrong.", opts: [{ v: "off", l: "Off" }] }),
  sw(NO_BIG)("Plan which app does each task", "A read-only planner gives each task its coding app and model; you edit it first."),
  sw(NO_BIG)("Changes as proposals", "Each change gets a proposal, its requirements and tasks, then is archived."),
  sw(NO_BIG)("Build an app from a description", "A spec writer, an architect and developers, with your review between stages."),
  sw(NO_BIG)("Stages need evidence", "Work moves to the next stage only with linked tests or an explained skip."),
] };

const SUGGEST: SecSpec = { t: "Suggestions while you edit", lv: 1, rows: [
  sw(NO_SUGGEST)("Finish the line as you type", "Faint text you accept with Tab, in Branch’s file editor."), sw(NO_SUGGEST)("Suggest the next edit", "From your recent edits, it suggests the next change, even elsewhere in the file."),
  off("pick", NO_SUGGEST)("Model for suggestions", { sub: "A small, fast model works best.", opts: [{ v: "auto", l: "A small, fast model" }] }),
  sw(NO_SUGGEST)("Use the whole project", "Suggestions draw on recent edits, open files and the code they use."),
] };

const APPS: SecSpec = { t: "Coding apps", lv: 1, rows: [
  { t: "Hand coding to another app", k: "pick", key: "acp.enabled", def: true, opts: [{ v: false, l: "Don’t hand it off" }, { v: true, l: "Hand it to a coding app" }], sub: "A coding app on this computer can take a coding task as a background helper." },
  sw(NO_APPS)("If one fails, try another", "Repeated failures move the task to the next coding app you set up."),
  sw(NO_APPS)("Their questions come to Inbox", "Coding apps’ permission prompts and questions arrive in Inbox, answered in one place."),
  sw(NO_APPS)("Trust new copies for coding apps", "A coding app started in a fresh copy doesn’t stop at its trust question."),
  sw(NO_APPS)("Install coding apps into Trunks’ computers", "Pinned versions go into each Trunk’s own computer."),
  sw(NO_APPS)("Coding apps in cloud computers", "A cloud computer runs the chosen coding app and streams it back."),
  sw(NO_APPS)("Run on another computer", "A paired computer runs one approved turn and streams it back."),
  sw(NO_APPS)("Let editors drive Branch", "Editors that speak the agent protocol can talk to Branch."),
  sw(NO_APPS)("Edits go through the editor", "When an editor drives Branch, edits land in its open files."),
  off("pick", "Where “Open in editor” goes is set by the Branch app.")("Your editor", { sub: "Where “Open in editor” goes.", opts: [{ v: "code", l: "VS Code" }] }),
  off("btn", "The editor add-on is installed from the Branch app.")("Editor add-on", { sub: "Sends your open file, selection and saves to Branch.", btn: "Install" }),
  off("btn", NO_APPS)("Branch over your own shell", { sub: "A key opens Branch over your terminal; it reads the screen after hiding secrets.", btn: "Set up" }),
  sw(NO_APPS)("Disassembler bridge", "Lets a Trunk read and annotate a program in your disassembler."),
] };

export const CODE_SECS: SecSpec[] = [CODE, CODE_MORE, KNOWS, GIT, CHECKS, BIG, SUGGEST, APPS];

export const CODE_TECH: SecSpec = { t: "Code, technical", group: "Code", showHeading: false, lv: 2, rows: [
  off("code", NO_CODE)("Files Branch never reads", { sub: "Like .gitignore.", code: ".branchignore" }),
  sw(NO_CODE)("Read a file before editing it", "Refuses an edit to a file it hasn’t read in this task. Off until you choose: it stops edits that would otherwise go through."),
  sw(NO_CODE)("Keep large tool outputs", "Saved to a file instead of cut off."),
  off("btn", "Needs a published Branch CI setup.")("Branch in CI", { sub: "A GitHub Action and a GitLab component.", btn: "Copy the setup" }),
  { t: "Where copies live", k: "change", key: "worktreeRoot", ph: "Branch’s own folder", btn: "Change…", sub: "Applies to new copies only." },
  { t: "Fast copies", k: "sw", key: "worktreeAcceleration", def: true, sub: "Uses the disk’s own cloning (Btrfs, APFS or ReFS) when it can." },
  sw(NO_CODE)("Find edits that are slightly off", "Edits with wrong spacing or indents still find their place."), sw(NO_CODE)("Structural edits", "Edits by code pattern, not by text."),
  off("pick", NO_CODE)("Code map size", { sub: "Grows when no files are in the conversation.", opts: [{ v: 1024, l: "1,024 tokens" }] }),
  off("pick", NO_CODE)("Refresh the code map", { sub: "“Automatically” rebuilds it when it is slow to make.", opts: [{ v: "auto", l: "Automatically" }] }),
  sw(NO_CODE)("Install language helpers when needed", "Missing language helpers are installed with your package manager."),
  sw(NO_CODE)("Fast TypeScript check", "A native compiler checks types quickly after each edit."),
  sw(NO_CODE)("Fix common TypeScript errors without a model", "Missing imports and wrong paths are repaired by rules."),
  sw(NO_CODE)("Try edits in memory first", "An edit is checked by the language helper before it touches the disk."),
  off("btn", "Needs the engine to take checkpoints before each turn.")("Checkpoints", { sub: "Taken before each turn’s edits; old ones are pruned by themselves.", btn: "Clean up now" }),
  sw("Needs the engine to take checkpoints before each turn.")("Very large projects: ask before checkpoints", "When a snapshot is slow, it asks whether to skip it."),
  sw(NO_CODE)("Copies made ahead", "Ready copies so a new conversation starts at once."),
  off("pick", NO_CODE)("Where conversations work", { sub: "New coding conversations start here.", opts: [{ v: "folder", l: "In the folder" }] }),
  sw(NO_CODE)("A full app stack per copy", "Each copy gets its own services on its own ports."), sw(NO_CODE)("Open projects in their dev container", "A project with a dev container runs inside it."),
  off("pick", NO_CODE)("Build on another computer", { sub: "Heavy builds are sent there and the results come back.", opts: [{ v: "here", l: "This computer" }] }),
  sw(NO_CODE)("Projects in their own folder store", "Each project gets a sealed folder store with its own history and rollback."),
  sw("Needs the engine to let Branch edit its own files.")("Let Branch change its own code", "Branch may edit its own files and restart; some paths stay locked."),
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
    <Dialog title={title} wide onClose={onClose}>
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
