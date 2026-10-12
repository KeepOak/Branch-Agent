// What the stage knows about computers and the conversation's plan, read from engine results only.
import type { EnvironmentSummary } from "@branch/gateway-protocol";
import type { WindowEngine } from "../connect/engine";
import type { ProgressCard } from "../thread/PlanCard";
import { environmentLabel } from "./use-desktop";

export type Placement = {
  state?: string;
  environmentId?: string;
  generation?: number;
  ownerEpoch?: number;
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** This conversation's placement from sessions.describe; undefined when the engine reported none. */
export async function describePlacement(engine: WindowEngine): Promise<Placement | undefined> {
  const described = rec(await engine.request("sessions.describe", { key: engine.sessionKey }));
  const session = rec(described.session);
  if (session.key !== engine.sessionKey || !session.placement) return undefined;
  const p = rec(session.placement);
  return { state: str(p.state), environmentId: str(p.environmentId), generation: num(p.generation), ownerEpoch: num(p.ownerEpoch) };
}

/** The computer a placement runs on: an active worker's id, or the host ("gateway") for an explicitly local one. */
export function placementComputer(p: Placement | undefined): string | null {
  if (p?.state === "active" && p.environmentId) return p.environmentId;
  if (p?.state === "local") return "gateway";
  return null;
}

export type Computer = {
  id: string;
  name: string;
  /** "Windows · offline", from platform and status. */
  sub: string;
  desktop: boolean;
  available: boolean;
  /** Whether the engine advertises paired-session hosting on this computer. */
  sessionHost?: boolean;
  /** Worker slots in use, only when the engine reports slots. */
  busy?: { used: number; total: number };
  /** A run is on it now (worker attachments). */
  working: boolean;
  /** The id sessions.dispatch and sessions.move use for a paired device. */
  deviceId?: string;
};

const OS: Record<string, string> = { win32: "Windows", windows: "Windows", darwin: "macOS", macos: "macOS", linux: "Linux" };
const STATUS: Record<string, string> = { unavailable: "offline", starting: "starting", stopping: "stopping", error: "has a problem" };

export function readComputer(env: EnvironmentSummary): Computer {
  const os = env.platform ? OS[env.platform.toLowerCase()] ?? env.platform : "";
  const parts = [os, env.desktop ? "" : "no screen", STATUS[env.status] ?? ""].filter(Boolean);
  const slots = env.workerSlots;
  return {
    id: env.id,
    name: environmentLabel(env),
    sub: parts.join(" · "),
    desktop: env.desktop === true,
    available: env.status === "available",
    sessionHost: env.sessionHost === true,
    ...(slots ? { busy: { used: Math.max(0, slots.total - slots.available - (slots.reclaimableIdle ?? 0)), total: slots.total } } : {}),
    working: (env.worker?.attachedSessionIds.length ?? 0) > 0,
    ...(env.id.startsWith("node:") ? { deviceId: env.id.slice(5) } : {}),
  };
}

/** environments.list, read into computers: the host first, then the rest in the engine's order. */
export async function listComputers(engine: WindowEngine): Promise<{ computers: Computer[]; profiles: { id: string; name: string }[] }> {
  const result = rec(await engine.request("environments.list", {}));
  const envs = (Array.isArray(result.environments) ? result.environments : []) as EnvironmentSummary[];
  const computers = envs.filter((e) => e && typeof e.id === "string").map(readComputer);
  computers.sort((a, b) => (a.id === "gateway" ? -1 : b.id === "gateway" ? 1 : 0));
  const profiles = (Array.isArray(result.profiles) ? result.profiles : []).map(rec).filter((p) => str(p.id)).map((p) => ({ id: String(p.id), name: str(p.providerDisplayId) ?? String(p.id) }));
  return { computers, profiles };
}

export type PlanStep = { text: string; state: "done" | "now" | "todo" };

/** The progress card's steps, in order, as the plan list and step strip show them. */
export function planSteps(card: ProgressCard | null): PlanStep[] {
  return (card?.steps ?? []).map((s) => ({
    text: s.step.trim(),
    state: s.status === "completed" ? "done" : s.status === "in_progress" ? "now" : "todo",
  }));
}

export type Pill = { kind: "work" | "you" | "idle"; text: string };

/** The state pill: "You have control", "Working · step 2 of 4", "Working" or "Idle". */
export function stagePill(running: boolean, controlling: boolean, steps: PlanStep[]): Pill {
  if (controlling) return { kind: "you", text: "You have control" };
  if (!running) return { kind: "idle", text: "Idle" };
  const now = steps.findIndex((s) => s.state === "now");
  return now >= 0 ? { kind: "work", text: `Working · step ${now + 1} of ${steps.length}` } : { kind: "work", text: "Working" };
}

/** The computer chip's words: one computer is named; more are counted. */
export function pickerLabel(computers: Computer[], current: string | null): string {
  const shown = computers.filter((c) => c.desktop || c.id === current);
  if (shown.length > 1) return `${shown.length} computers`;
  return shown[0]?.name ?? computers.find((c) => c.id === current)?.name ?? "No computer";
}


/** Tells every open computer list (the stage, Settings › Computer & browser) to read the engine again. */
export function computersChanged(): void {
  window.dispatchEvent(new CustomEvent("branch:computers-changed"));
}
