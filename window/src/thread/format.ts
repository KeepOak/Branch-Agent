// Words and numbers the thread shows (DESIGN-SPEC §4.2, §7.1 rule 9).
import type { Block } from "./model";

export function formatDuration(ms?: number): string {
  if (!ms || ms < 0) {
    return "";
  }
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "10:42" today; "2 days ago" before today (the full date and time is the tooltip). */
export function messageTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const days = Math.max(1, Math.round((today.setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86_400_000));
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export function fullTime(ms: number): string {
  return new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** "m:ss" for the approval's "Expires in". */
export function clockLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

type Step = Extract<Block, { kind: "step" }>;

/** The step line's words (Hermes-style: what it is doing now, what it did once done). */
export function stepLabel(step: Step): string {
  const running = step.status === "running";
  if (step.tool === "exec" || step.tool === "process") {
    return running ? "Running a command" : step.status === "denied" ? "Command not run" : "Ran a command";
  }
  if (step.tool === "read") {
    return running ? "Reading a file" : "Read a file";
  }
  if (step.tool === "sessions_spawn") {
    return running ? "Starting a helper" : "Started a helper";
  }
  return running ? `Using ${step.tool}` : `Used ${step.tool}`;
}

function counted(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace("#", String(n));
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The Steps fold's summary: the step at work while it runs, then what was done ("Ran 2 commands and read a file"). */
export function stepsSummary(steps: readonly Step[], run?: { title: string; durationMs?: number }): string {
  const running = steps.find((s) => s.status === "running");
  if (running) {
    return stepLabel(running);
  }
  if (run?.title) {
    return [run.title, steps.length > 1 ? `${steps.length} steps` : "1 step", run.durationMs ? formatDuration(run.durationMs) : ""].filter(Boolean).join(" · ");
  }
  const commands = steps.filter((s) => s.tool === "exec" || s.tool === "process").length;
  const reads = steps.filter((s) => s.tool === "read").length;
  const others = [...new Set(steps.filter((s) => !["exec", "process", "read"].includes(s.tool)).map((s) => s.tool))];
  const parts = [
    ...(commands ? [counted(commands, "ran a command", "ran # commands")] : []),
    ...(reads ? [counted(reads, "read a file", "read # files")] : []),
    ...others.map((tool) => `used ${tool}`),
  ];
  const text = joinWords(parts);
  const times = steps.map((s) => s.at).filter((at): at is number => typeof at === "number");
  const took = times.length >= 2 ? formatDuration(Math.max(...times) - Math.min(...times)) : "";
  const tail = [steps.length > 1 ? `${steps.length} steps` : "", took].filter(Boolean).join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1) + (tail ? ` · ${tail}` : "");
}

/** The thread's day stamp (§4.2.2 Stamp): "Today 10:05", "Yesterday 4:18 PM", else "Sep 30 4:18 PM". */
export function dayStamp(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  return `${d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}

/** "Getting started words" (§4.2.5 Parity adds) for the engine's run_status phases. */
export const PHASE_WORDS: Record<string, string> = {
  waiting_for_state: "Waiting for a reply…",
  preparing_workspace: "Preparing the folder…",
  naming_worktree: "Naming the separate copy…",
  creating_worktree: "Making a separate copy…",
  running_setup: "Running setup…",
  provisioning_environment: "Getting its computer ready…",
  preparing_context: "Preparing this turn…",
  memory_flushing: "Saving what it remembers…",
  starting_model: "Preparing this turn…",
};

export function phaseWords(status: Extract<Block, { kind: "status" }>): string {
  if (status.attempt && status.maxAttempts) {
    return `Trying again… ${status.attempt} of ${status.maxAttempts}`;
  }
  return PHASE_WORDS[status.phase] ?? "";
}

/** The first sentence of an engine error, without the engine's own lead-in and warning sign. */
export function shortReason(message: string): string {
  const plain = message
    .replace(/^\s*[⚠️❗❌\s]+/u, "")
    .replace(/^Your request couldn['’]t be completed:\s*/i, "")
    .replace(/^[⚠️\s]+/u, "")
    .trim();
  const first = /^(.+?[.!?])(\s|$)/.exec(plain)?.[1] ?? plain;
  return first.length > 160 ? `${first.slice(0, 157)}…` : first;
}

/** A model id as the hover bar shows it: the part after the provider. */
export function modelName(model?: string): string {
  return model ? model.replace(/^[^/]+\//, "") : "";
}
