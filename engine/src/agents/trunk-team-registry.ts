import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/** Which Trunks belong to a team and where its room is. Team jobs are claimable only by these members. */
export type TeamRecord = { roomId: string; members: string[] };
type TeamRegistry = Record<string, TeamRecord>;

function file(env?: NodeJS.ProcessEnv): string {
  return path.join(resolveStateDir(env), "trunks", "teams.json");
}

function read(env?: NodeJS.ProcessEnv): TeamRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(env), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as TeamRegistry)
      : {};
  } catch {
    return {};
  }
}

/** Records a team's members and room. Registering the same team again replaces its record. */
export function registerTeam(teamId: string, record: TeamRecord, env?: NodeJS.ProcessEnv): void {
  const teams = read(env);
  teams[teamId] = { roomId: record.roomId, members: [...new Set(record.members)] };
  const target = file(env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(teams, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

/** The members of a team, or undefined when no such team is registered. */
export function teamMembers(teamId: string, env?: NodeJS.ProcessEnv): string[] | undefined {
  return read(env)[teamId]?.members;
}
