// "Where it works" on an empty conversation (DESIGN-SPEC §4.2.9, the preview's where-pb18): the computer chip, the
// folder chip and, at Advanced, the copy chip, just above the composer. The computer moves the conversation
// (sessions.dispatch / sessions.move); a folder, a pasted path, a Git link or a separate copy starts the conversation
// there on its first send (sessions.create with projectId, cwd, projectGitUrl or worktree).
import { useEffect, useState, type MouseEvent } from "react";
import type { Conversation } from "../connect/conversations";
import type { WindowEngine } from "../connect/engine";
import { currentModelRef } from "../composer/model";
import { hasNoModel, useConversation } from "../composer/useConversation";
import { Icon } from "../shell/icons";
import type { MenuAnchor } from "../shell/Menu";
import { Popover } from "../shell/Popover";
import { describePlacement, listComputers, placementComputer, type Computer, type Placement } from "../stage/computers";
import { moveConversation } from "../stage/ComputerPicker";
import "./empty.css";

type Project = { id: string; name: string };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const NOT_GIT = "This folder isn’t a Git project";

const isPath = (q: string) => /^([a-zA-Z]:[\\/]|\/|~[\\/])/.test(q.trim());
const isGit = (q: string) => /^(https?:\/\/|git@)\S+$/.test(q.trim());
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

type Props = {
  engine: WindowEngine;
  row: Conversation | null;
  trunkName: string;
  advanced: boolean;
  projectName: string | null;
  onStartTopic: (params: Record<string, unknown>) => void;
  draft?: boolean;
};

function useWhere(engine: WindowEngine) {
  const [state, setState] = useState<{ computers: Computer[]; placement?: Placement; projects: Project[] }>({ computers: [], projects: [] });
  const load = () => {
    Promise.allSettled([listComputers(engine), describePlacement(engine), engine.request("projects.list", {})]).then(([c, p, pr]) =>
      setState({
        computers: c.status === "fulfilled" ? c.value.computers : [],
        placement: p.status === "fulfilled" ? p.value : undefined,
        projects: pr.status === "fulfilled" ? (Array.isArray(rec(pr.value).projects) ? (rec(pr.value).projects as unknown[]).map(rec) : []).map((x) => ({ id: str(x.id), name: str(x.displayName) || str(x.id) })).filter((x) => x.id) : [],
      }),
    );
  };
  useEffect(load, [engine]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

type Open = { kind: "comp" | "folder" | "copy"; at: MenuAnchor } | null;

export function WhereChips(p: Props) {
  const conv = useConversation(p.engine);
  const where = useWhere(p.engine);
  const [open, setOpen] = useState<Open>(null);
  const [selectedComputer, setSelectedComputer] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [error, setError] = useState("");
  if (!conv.loaded || hasNoModel(conv, currentModelRef(conv.row, conv.defaults))) return null;
  const current = placementComputer(where.placement);
  const computerId = selectedComputer ?? current ?? "gateway";
  const compName = computerId === "free" ? "Any free computer" : where.computers.find((c) => c.id === computerId)?.name ?? "This computer";
  const folderName = selectedFolder ?? p.projectName ?? (p.row?.folder ? base(p.row.folder) : `${p.trunkName}’s own folder`);
  const git = Boolean(p.row?.repoBranch);
  const toggle = (kind: "comp" | "folder" | "copy") => (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setOpen((cur) => (cur?.kind === kind ? null : { kind, at: { x: r.left, y: r.bottom + 4 } }));
  };
  const start = async (params: Record<string, unknown>) => {
    setOpen(null);
    setError("");
    if (p.draft) {
      setSelectedComputer("gateway");
      const project = where.projects.find((item) => item.id === params.projectId);
      setSelectedFolder(project?.name ?? (typeof params.cwd === "string" ? base(params.cwd) : typeof params.projectGitUrl === "string" ? base(params.projectGitUrl).replace(/\.git$/, "") : params.worktreeSource === "empty" ? "New empty folder" : params.worktree ? "New separate copy" : null));
    }
    p.onStartTopic(params);
  };
  return (
    <div className="where-chips" data-testid="where-chips">
      <button type="button" className="chip-c" aria-expanded={open?.kind === "comp"} onClick={toggle("comp")}>
        <Icon name="monitor" small />
        <span className="lbl">{compName}</span>
        <Icon name="down" small />
      </button>
      <button type="button" className="chip-c" aria-expanded={open?.kind === "folder"} onClick={toggle("folder")}>
        <Icon name="folder" small />
        <span className="lbl">{folderName}</span>
        <Icon name="down" small />
      </button>
      {p.advanced ? (
        <button type="button" className="chip-c" disabled={!git} title={git ? undefined : NOT_GIT} aria-expanded={open?.kind === "copy"} onClick={toggle("copy")}>
          <Icon name="branch" small />
          <span className="lbl">Current copy</span>
          <Icon name="down" small />
        </button>
      ) : null}
      {error ? <p className="where-err" role="alert">{error}</p> : null}
      {open?.kind === "comp" ? (
        <Popover at={open.at} onClose={() => setOpen(null)} label="Where it works" testid="where-comp">
          <div className="ph">Where it works</div>
          {where.computers.map((c) => (
            <button key={c.id} type="button" className="mi" role="menuitemradio" aria-checked={c.id === computerId} disabled={c.id !== "gateway" && !c.deviceId}
              title={c.id !== "gateway" && !c.deviceId ? "A cloud computer is picked by its kind." : undefined}
              onClick={() => {
                const target = c.id === "gateway" ? { kind: "gateway" as const } : { kind: "device" as const, deviceId: c.deviceId ?? "" };
                if (p.draft) {
                  setSelectedComputer(c.id);
                  setSelectedFolder(null);
                  setOpen(null);
                  p.onStartTopic({ execNode: c.id === "gateway" ? undefined : c.deviceId });
                } else moveConversation(p.engine, where.placement, target).then(() => (setOpen(null), where.reload()), (e: unknown) => setError(`Couldn't move it: ${reason(e)}.`));
              }}>
              <span className="tick" aria-hidden="true">{c.id === computerId ? <Icon name="check" small /> : null}</span>
              <span className="mi-t">
                <span>{c.name}</span>
                {c.sub ? <small className="mi-s">{c.sub}</small> : null}
              </span>
            </button>
          ))}
          <button type="button" className="mi" role="menuitemradio" aria-checked={selectedComputer === "free"} onClick={() => {
            if (p.draft) { setSelectedComputer("free"); setSelectedFolder(null); setOpen(null); p.onStartTopic({ execNode: undefined }); }
            else moveConversation(p.engine, where.placement, { kind: "free" }).then(() => (setOpen(null), where.reload()), (e: unknown) => setError(`Couldn't move it: ${reason(e)}.`));
          }}>
            <span className="tick" aria-hidden="true" />
            <span className="mi-t">
              <span>Any free computer</span>
              <small className="mi-s">Picks the least busy one</small>
            </span>
          </button>
        </Popover>
      ) : null}
      {open?.kind === "folder" ? <FolderPop at={open.at} projects={where.projects} onClose={() => setOpen(null)} start={start} /> : null}
      {open?.kind === "copy" ? <CopyPop at={open.at} onClose={() => setOpen(null)} start={(name) => start({ ...(p.row?.folder ? { cwd: p.row.folder } : {}), worktree: true, ...(name ? { worktreeName: name } : {}) })} /> : null}
    </div>
  );
}

function FolderPop({ at, projects, onClose, start }: { at: MenuAnchor; projects: Project[]; onClose: () => void; start: (params: Record<string, unknown>) => Promise<void> }) {
  const [q, setQ] = useState("");
  const list = projects.filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover at={at} onClose={onClose} label="Folder" testid="where-folder" width={320}>
      <div className="ph">Folder</div>
      <label className="row-in">
        <input className="inp" placeholder="Search projects or paste a Git link" aria-label="Search projects or paste a Git link" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {isGit(q) ? (
        <button type="button" className="mi" onClick={() => void start({ projectGitUrl: q.trim() })}>
          <Icon name="download" small />
          <span className="mi-t">Clone {base(q.trim()).replace(/\.git$/, "")}</span>
        </button>
      ) : null}
      {isPath(q) ? (
        <button type="button" className="mi" onClick={() => void start({ cwd: q.trim() })}>
          <Icon name="folder" small />
          <span className="mi-t">Use {base(q.trim())}</span>
        </button>
      ) : null}
      <div className="ph">Projects</div>
      {list.length ? list.map((x) => (
        <button key={x.id} type="button" className="mi" onClick={() => void start({ projectId: x.id })}>
          <Icon name="folder" small />
          <span className="mi-t">{x.name}</span>
        </button>
      )) : <p className="pp">No projects match.</p>}
      <hr />
      <button type="button" className="mi" onClick={() => void start({ worktree: true, worktreeSource: "empty" })}>
        <Icon name="plus" small />
        <span className="mi-t">New empty folder</span>
      </button>
    </Popover>
  );
}

function CopyPop({ at, onClose, start }: { at: MenuAnchor; onClose: () => void; start: (name: string) => Promise<void> }) {
  const [mode, setMode] = useState<"current" | "new">("current");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  return (
    <Popover at={at} onClose={onClose} label="Copy" testid="where-copy" width={320}>
      <div className="ph">Copy</div>
      <button type="button" className="mi" role="menuitemradio" aria-checked={mode === "current"} onClick={onClose}>
        <span className="tick" aria-hidden="true">{mode === "current" ? <Icon name="check" small /> : null}</span>
        <span className="mi-t"><span>Current copy</span><small className="mi-s">Works in the folder on its current branch.</small></span>
      </button>
      <button type="button" className="mi" role="menuitemradio" aria-checked={mode === "new"} onClick={() => setMode("new")}>
        <span className="tick" aria-hidden="true">{mode === "new" ? <Icon name="check" small /> : null}</span>
        <span className="mi-t"><span>New separate copy</span><small className="mi-s">An isolated copy of the project, on a new branch</small></span>
      </button>
      {mode === "new" ? (
        <>
          <label className="fld where-fld">
            <span>Name</span>
            <input className="inp" placeholder="Named from the conversation" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {err ? <p className="pp" role="alert">{err}</p> : null}
          <div className="acts where-acts">
            <button type="button" className="btn sm primary" onClick={() => (name && !/^[a-z0-9-]+$/.test(name) ? setErr("Use lowercase letters, digits and dashes.") : void start(name))}>Use this copy</button>
          </div>
        </>
      ) : null}
    </Popover>
  );
}
