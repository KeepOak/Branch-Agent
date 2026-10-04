// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { Dialog } from "../../shell/Dialog";
import { SIcon } from "../stage-icons";
import { gapBetween, parsePatch, splitRows, type DiffLine, type Hunk } from "./diff";
import { PullRequestBox } from "./PullRequest";
import "./coding.css";

type DiffFile = { path: string; oldPath?: string; status: "added" | "modified" | "deleted" | "renamed"; additions: number; deletions: number; binary?: boolean; untracked?: boolean; patch?: string; truncated?: boolean };
type Diff = { root?: string; branch?: string; baseRef?: string; aheadCount?: number; commits?: { sha: string; subject: string }[]; files: DiffFile[]; additions: number; deletions: number; truncated?: boolean; unavailableReason?: string };
type Scope = { kind: "all" } | { kind: "uncommitted" } | { kind: "commit"; sha: string; subject: string };

const STATUS: Record<DiffFile["status"], [string, string]> = { added: ["done", "Added"], modified: ["warn", "Changed"], deleted: ["no", "Deleted"], renamed: ["warn", "Renamed"] };
const UNAVAILABLE: Record<string, string> = {
  not_git: "This folder isn't a git checkout.",
  unknown_session: "No folder goes with this conversation.",
  unknown_commit: "That commit isn't in this checkout any more.",
  workspace_stopped: "This conversation's computer is stopped, so its checkout can't be read.",
};
const NO_COMMIT = "The engine can't make a commit from the window yet; opening a pull request commits the changes.";
const NO_COPY = "Moving a conversation into a separate copy isn't wired in this window yet.";
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Line({ l, wrap }: { l: DiffLine; wrap: boolean }) {
  return (
    <span className={`ln-cd ${l.kind}${wrap ? " wrap" : ""}`}>
      <em>{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</em>
      {l.text}
    </span>
  );
}

function HunkView({ h, split, wrap }: { h: Hunk; split: boolean; wrap: boolean }) {
  if (!split)
    return (
      <pre className="hunk-cd">
        {h.lines.map((l, i) => (
          <Line key={i} l={l} wrap={wrap} />
        ))}
      </pre>
    );
  return (
    <div className="hunk-split-cd">
      {splitRows(h).map((r, i) => (
        <div key={i} className="row-cd">
          <pre>{r.left && r.left.kind !== "add" ? <Line l={r.left} wrap={wrap} /> : " "}</pre>
          <pre>{r.right && r.right.kind !== "del" ? <Line l={r.right} wrap={wrap} /> : " "}</pre>
        </div>
      ))}
    </div>
  );
}

function FileView({ f, open, onToggle, split, wrap, onMenu }: { f: DiffFile; open: boolean; onToggle: () => void; split: boolean; wrap: boolean; onMenu: (at: MenuAnchor) => void }) {
  const hunks = f.patch ? parsePatch(f.patch) : [];
  const [tone, word] = STATUS[f.status];
  return (
    <div className="file-cd">
      <div className="file-h-cd">
        <button type="button" className="tog-cd" aria-expanded={open} onClick={onToggle}>
          <SIcon name="chev" small className="chev-cd" />
          <b>{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</b>
        </button>
        <span className={`pill ${tone}`}>{f.untracked ? "New" : word}</span>
        <small>
          +{f.additions} −{f.deletions}
        </small>
        <button type="button" className="ib sm" aria-haspopup="menu" aria-label={`More for ${f.path}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ x: r.right - 200, y: r.bottom + 4 }); }}>
          <SIcon name="more" small />
        </button>
      </div>
      {open ? (
        f.binary ? (
          <p className="hint-st">Binary file</p>
        ) : !f.patch ? (
          <p className="hint-st">{f.truncated ? "Too big to show here." : "No text changes."}</p>
        ) : (
          hunks.map((h, i) => (
            <div key={i}>
              {i > 0 && gapBetween(hunks[i - 1]!, h) > 0 ? <div className="gap-cd">{gapBetween(hunks[i - 1]!, h)} unchanged lines</div> : null}
              <HunkView h={h} split={split} wrap={wrap} />
            </div>
          ))
        )
      ) : null}
    </div>
  );
}

/** Sync to your own checkout: a git command that fetches this conversation's branch from its folder. */
function SyncDialog({ root, branch, onClose }: { root: string; branch: string; onClose: () => void }) {
  const [dir, setDir] = useState("");
  const [copied, setCopied] = useState(false);
  const command = `git -C "${dir || "<your checkout>"}" fetch "${root}" ${branch}:${branch}`;
  return (
    <Dialog
      title="Sync to your own checkout"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn pri" disabled={!dir.trim()} onClick={() => void navigator.clipboard.writeText(command).then(() => setCopied(true), () => setCopied(false))}>
            {copied ? "Copied" : "Copy command"}
          </button>
        </>
      }
    >
      <p className="p0-st">Run this in your own checkout to copy this conversation's commits.</p>
      <label className="fld-st">
        <span>Checkout folder</span>
        <input className="inp" value={dir} onChange={(e) => { setDir(e.target.value); setCopied(false); }} spellCheck={false} placeholder="The folder of your own checkout" />
      </label>
      <pre className="cmd-cd">{command}</pre>
      <p className="hint-st p0-st">Uncommitted changes stay where they are.</p>
    </Dialog>
  );
}

/** Changes: what this conversation's checkout changed (sessions.diff), per scope, with a pull request at the end. */
export function ChangesTab({ engine }: { engine: WindowEngine }) {
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [tick, setTick] = useState(0);
  const [data, setData] = useState<{ key: string; diff?: Diff; error?: string }>({ key: "" });
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ at: MenuAnchor; items: MenuItem[]; label: string } | null>(null);
  const [sync, setSync] = useState(false);
  const key = `${engine.sessionKey}|${JSON.stringify(scope)}|${tick}`;
  useEffect(() => {
    let live = true;
    engine.request<Diff>("sessions.diff", { sessionKey: engine.sessionKey, scope: scope.kind, ...(scope.kind === "commit" ? { commit: scope.sha } : {}) }).then(
      (diff) => live && setData({ key, diff }),
      (e: unknown) => live && setData({ key, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine, scope, key]);
  const cur = data.key === key ? data : { key };
  const diff = cur.diff;
  if (cur.error) return <p className="err-st" role="alert">{cur.error}</p>;
  if (!diff) return <p className="pane-empty">Reading this conversation's changes…</p>;
  if (diff.unavailableReason) return <p className="pane-empty">{UNAVAILABLE[diff.unavailableReason] ?? diff.unavailableReason}</p>;
  const commits = diff.commits ?? [];
  const scopeLabel = scope.kind === "all" ? "All changes" : scope.kind === "uncommitted" ? "Uncommitted" : `${scope.sha.slice(0, 7)} ${scope.subject}`;
  const scopeMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "Show",
      items: [
        { label: `${scope.kind === "all" ? "✓ " : ""}All changes`, run: () => setScope({ kind: "all" }) },
        { label: `${scope.kind === "uncommitted" ? "✓ " : ""}Uncommitted`, run: () => setScope({ kind: "uncommitted" }) },
        ...(commits.length ? [{ kind: "sep" } as MenuItem] : []),
        ...commits.map((c): MenuItem => ({ label: `${scope.kind === "commit" && scope.sha === c.sha ? "✓ " : ""}${c.sha.slice(0, 7)} ${c.subject}`, run: () => setScope({ kind: "commit", sha: c.sha, subject: c.subject }) })),
      ],
    });
  const viewMenu = (at: MenuAnchor) =>
    setMenu({
      at,
      label: "View",
      items: [
        { label: split ? "Unified view" : "Split view", run: () => setSplit((v) => !v) },
        { label: wrap ? "Don't wrap lines" : "Wrap lines", run: () => setWrap((v) => !v) },
        { label: closed.size ? "Expand all" : "Collapse all", run: () => setClosed(closed.size ? new Set() : new Set(diff.files.map((f) => f.path))) },
      ],
    });
  const fileMenu = (f: DiffFile, at: MenuAnchor) =>
    setMenu({
      at,
      label: `More for ${f.path}`,
      items: [{ label: "Copy path", run: () => void navigator.clipboard.writeText(diff.root ? `${diff.root.replace(/[\\/]$/, "")}/${f.path}` : f.path).catch(() => undefined) }],
    });
  const anchor = (e: React.MouseEvent<HTMLElement>, right = false): MenuAnchor => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: right ? r.right - 200 : r.left, y: r.bottom + 4 };
  };
  return (
    <div className="changes-cd">
      <div className="chg-h-cd">
        <button type="button" className="btn ghost sm" aria-haspopup="menu" onClick={(e) => scopeMenu(anchor(e))}>
          {scopeLabel}
          <SIcon name="down" small />
        </button>
        <small>
          {diff.aheadCount !== undefined && diff.baseRef ? `${diff.aheadCount} commit${diff.aheadCount === 1 ? "" : "s"} ahead of ${diff.baseRef}` : diff.branch ?? ""}
        </small>
        <span className="tb-grow" />
        <button type="button" className="ib sm" aria-label="Refresh" title="Refresh" onClick={() => setTick((t) => t + 1)}>
          <SIcon name="reload" small />
        </button>
        <button type="button" className="ib sm" aria-haspopup="menu" aria-label="View" title="View" onClick={(e) => viewMenu(anchor(e, true))}>
          <SIcon name="more" small />
        </button>
        <button type="button" className="btn sm" disabled={!diff.root || !diff.branch} title={diff.branch ? undefined : "This checkout has no branch to fetch."} onClick={() => setSync(true)}>
          Sync
        </button>
      </div>
      <p className="hint-st p0-st">
        +{diff.additions} −{diff.deletions} in {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
        {diff.truncated ? " · showing the first part" : ""}
      </p>
      {diff.files.length ? (
        diff.files.map((f) => <FileView key={f.path} f={f} open={!closed.has(f.path)} split={split} wrap={wrap} onToggle={() => setClosed((s) => { const n = new Set(s); if (n.has(f.path)) n.delete(f.path); else n.add(f.path); return n; })} onMenu={(at) => fileMenu(f, at)} />)
      ) : (
        <p className="pane-empty">No changes in this conversation's checkout.</p>
      )}
      <div className="acts-br">
        <button type="button" className="btn ghost sm" disabled title={NO_COMMIT}>
          Commit
        </button>
        <button type="button" className="btn ghost sm" disabled title={NO_COPY}>
          Move to a separate copy
        </button>
      </div>
      <PullRequestBox engine={engine} hasChanges={diff.files.length > 0 || (diff.aheadCount ?? 0) > 0} />
      {menu ? <Menu at={menu.at} items={menu.items} label={menu.label} onClose={() => setMenu(null)} /> : null}
      {sync && diff.root && diff.branch ? <SyncDialog root={diff.root} branch={diff.branch} onClose={() => setSync(false)} /> : null}
    </div>
  );
}
