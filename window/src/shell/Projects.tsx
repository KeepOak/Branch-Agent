// The sidebar's Projects (DESIGN-SPEC §4.1.1, parity "Projects"): the engine's projects (projects.list), each with
// how many conversations belong to it and, unfolded, those conversations. "+" adds one: a folder on this computer
// (projects.register) or a Git address (projects.add).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Conversation } from "../connect/conversations";
import type { SaplingSession } from "../connect/session";
import { Dialog } from "./Dialog";
import { Icon } from "./icons";
import { notify } from "./notify";
import "./projects.css";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export type Project = { id: string; name: string };

export function readProjects(result: unknown): Project[] {
  const list = rec(result).projects;
  return (Array.isArray(list) ? list.map(rec) : []).map((p) => ({ id: str(p.id), name: str(p.displayName) || str(p.id) })).filter((p) => p.id);
}

export function useProjects(session: SaplingSession, ready: boolean): { projects: Project[]; reload: () => void } {
  const [projects, setProjects] = useState<Project[]>([]);
  const reload = useCallback(() => {
    session.request("projects.list", {}).then(
      (r) => setProjects(readProjects(r)),
      (error: unknown) => console.warn("projects.list failed", error),
    );
  }, [session]);
  useEffect(() => {
    if (ready) {
      reload();
    }
  }, [ready, reload]);
  return { projects, reload };
}

const FOLD_KEY = "branch.projectsOpen";
function readOpen(): boolean {
  try {
    return localStorage.getItem(FOLD_KEY) === "1";
  } catch {
    return false; // storage blocked: folded, as it ships
  }
}

type Props = { projects: Project[]; rows: Conversation[]; renderRows: (rows: Conversation[]) => ReactNode; onNew: () => void };

/** The Projects heading and, unfolded, one row per project with its conversations under it. */
export function ProjectsSection({ projects, rows, renderRows, onNew }: Props) {
  const [open, setOpen] = useState(readOpen);
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(FOLD_KEY, open ? "0" : "1");
    } catch {
      // storage blocked: the fold lasts for this window only
    }
  };
  return (
    <section className="list-sec projects" data-section="projects">
      <div className="lh-row projh">
        <button type="button" className="lh lh-btn" aria-expanded={open} onClick={toggle} data-hide="projects">
          <Icon name={open ? "down" : "chev"} small />
          Projects
        </button>
        <button type="button" className="ib sm" aria-label="New project" title="New project" data-testid="project-new" onClick={onNew}>
          <Icon name="plus" size={12} />
        </button>
      </div>
      {open && !projects.length ? <p className="list-empty">No projects yet.</p> : null}
      {open
        ? projects.map((p) => {
            const mine = rows.filter((r) => r.projectId === p.id);
            const isOpen = unfolded.includes(p.id);
            return (
              <div key={p.id} className="prj">
                <button type="button" className="prj-row" data-drag-key={`project:${p.id}`} aria-expanded={isOpen} onClick={() => setUnfolded(isOpen ? unfolded.filter((x) => x !== p.id) : [...unfolded, p.id])}>
                  <Icon name={isOpen ? "down" : "chev"} size={11} />
                  <span className="prj-name">{p.name}</span>
                  <span className="prj-count">{mine.length}</span>
                </button>
                {isOpen ? <div className="prj-rows">{mine.length ? renderRows(mine) : <p className="list-empty">No conversations in it yet.</p>}</div> : null}
              </div>
            );
          })
        : null}
    </section>
  );
}

/** "New project": a name and where it lives, a folder on this computer or a Git address. */
export function NewProjectDialog({ session, onDone, onClose }: { session: SaplingSession; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [busy, setBusy] = useState(false);
  const git = /^(https?:\/\/|git@|ssh:\/\/)/.test(where.trim());
  const create = async () => {
    setBusy(true);
    try {
      const params = { ...(name.trim() ? { name: name.trim() } : {}), ...(git ? { gitUrl: where.trim() } : { path: where.trim() }) };
      await session.request(git ? "projects.add" : "projects.register", params);
      onDone();
      onClose();
    } catch (e) {
      notify(`Couldn't create the project: ${e instanceof Error ? e.message : String(e)}`, { tone: "bad" });
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="New project"
      onClose={onClose}
      testid="new-project"
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" data-testid="project-create" disabled={busy || !where.trim()} onClick={() => void create()}>
            Create project
          </button>
        </>
      }
    >
      <label className="fld">
        <span>Name</span>
        <input className="inp" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fld">
        <span>Folder on this computer, or a Git address</span>
        <input className="inp" data-testid="project-where" value={where} onChange={(e) => setWhere(e.target.value)} />
      </label>
    </Dialog>
  );
}
