import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { withQueueLock } from "./trunk-queue-store.js";

/** Which Trunks belong to a team and where its room is. Team jobs are claimable only by these members. */
export type TeamRecord = { roomId: string; members: string[] };
type TeamRegistry = Record<string, TeamRecord>;

/**
 * What the queue can know about a team. "paused" means the registry itself cannot be trusted right now, so team jobs
 * wait without being marked as broken.
 */
export type TeamState =
  | { status: "members"; members: string[] }
  | { status: "unregistered" }
  | { status: "paused"; problem: string };

const CORRUPT_PREFIX = "teams.json.corrupt-";

function dirOf(env?: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env), "trunks");
}

function file(env?: NodeJS.ProcessEnv): string {
  return path.join(dirOf(env), "teams.json");
}

function keptAside(env?: NodeJS.ProcessEnv): string[] {
  try {
    return fs
      .readdirSync(dirOf(env))
      .filter((name) => name.startsWith(CORRUPT_PREFIX))
      .map((name) => path.join(dirOf(env), name));
  } catch {
    return [];
  }
}

/** A kept copy is never read back, so removing it is the way out, and that means setting the teams up again. */
function keptMessage(aside: string): string {
  return `The team registry was unreadable and was kept at ${aside}. That copy is never read back; removing it means setting the teams up again.`;
}

function unreadableMessage(target: string, reason: string): string {
  return `The team registry at ${target} could not be read (${reason}).`;
}

type Loaded = { teams: TeamRegistry } | { problem: string };

/**
 * Loads the registry. Any failure to read it is the paused state, never an exception: a file that cannot be parsed is
 * renamed aside (never overwritten), and an unreadable one (permissions, a directory in its place) is left alone.
 */
function load(env?: NodeJS.ProcessEnv): Loaded {
  const kept = keptAside(env);
  if (kept.length > 0) {
    return { problem: keptMessage(kept[0]!) };
  }
  const target = file(env);
  let text: string;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
    return code === "ENOENT" ? { teams: {} } : { problem: unreadableMessage(target, code) };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { teams: parsed as TeamRegistry };
    }
  } catch {
    // Not JSON: keep it aside below.
  }
  const aside = `${target}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(target, aside);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "rename failed";
    return { problem: unreadableMessage(target, code) };
  }
  return { problem: keptMessage(aside) };
}

/**
 * Records a team's members and room. Registering the same team again replaces its record. The write runs under the
 * queue lock, so two gateways updating the registry cannot interleave. It refuses while the registry is paused.
 */
export function registerTeam(teamId: string, record: TeamRecord, env?: NodeJS.ProcessEnv): void {
  withQueueLock(env, () => {
    const loaded = load(env);
    if ("problem" in loaded) {
      throw new Error(`${loaded.problem} Nothing was registered.`);
    }
    const teams = loaded.teams;
    teams[teamId] = { roomId: record.roomId, members: [...new Set(record.members)] };
    const target = file(env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(teams, null, 2)}\n`);
    fs.renameSync(tmp, target);
  });
}

/** What the queue may do with a team's jobs: its members, not set up here, or paused by a registry problem. */
export function teamState(teamId: string, env?: NodeJS.ProcessEnv): TeamState {
  const loaded = load(env);
  if ("problem" in loaded) {
    return { status: "paused", problem: loaded.problem };
  }
  const record = loaded.teams[teamId];
  return record ? { status: "members", members: record.members } : { status: "unregistered" };
}

/** The members of a team, or undefined when no such team is registered (or the registry is paused). */
export function teamMembers(teamId: string, env?: NodeJS.ProcessEnv): string[] | undefined {
  const state = teamState(teamId, env);
  return state.status === "members" ? state.members : undefined;
}
