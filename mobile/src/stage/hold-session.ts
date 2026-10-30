// Which conversation Take over should pause: the Trunk that is working, else the newest chat that can hold a Goal.
// The phone's take-control screen is opened from Computers, so it has no current sessionKey the way the window does.
import { useEffect, useState } from "react";
import { runningAgentIds } from "../agents/agentList";
import type { EngineLink } from "../pairing/pairingSession";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

export type HoldTarget = { sessionKey: string; agentId?: string; name: string };

function agentName(agentsResult: unknown, agentId: string | undefined): string {
  if (!agentId) return "";
  const listed = rec(agentsResult).agents;
  const rows = Array.isArray(listed) ? listed : [];
  for (const raw of rows) {
    const a = rec(raw);
    if (str(a.id) !== agentId) continue;
    return str(rec(a.identity).name) || str(a.name) || agentId;
  }
  return agentId;
}

function isWorking(row: Record<string, unknown>): boolean {
  const activeRunIds = Array.isArray(row.activeRunIds) ? row.activeRunIds.filter((id) => typeof id === "string" && id) : [];
  return row.hasActiveRun === true || activeRunIds.length > 0;
}

function shownChat(row: Record<string, unknown>): boolean {
  if (!str(row.key)) return false;
  if (row.archived === true) return false;
  if (row.kind === "group") return false;
  if (str(row.classification) === "system") return false;
  if (str(row.spawnedBy) || str(row.parentSessionKey)) return false;
  if (typeof row.spawnDepth === "number" && row.spawnDepth > 0) return false;
  const key = str(row.key);
  if (key.includes(":cron:") || key.endsWith(":system")) return false;
  return true;
}

/** The session Take over should pause, and the Trunk name Hand back uses. */
export function pickHoldSession(sessionsResult: unknown, agentsResult?: unknown): HoldTarget | null {
  const sessions = rec(sessionsResult).sessions;
  const rows = (Array.isArray(sessions) ? sessions : []).map(rec).filter(shownChat);
  const workingIds = runningAgentIds(sessionsResult);
  const working = rows.filter((r) => isWorking(r) || workingIds.has(str(r.agentId)));
  const pool = working.length ? working : rows;
  const pick = [...pool].sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))[0];
  if (!pick) return null;
  const agentId = str(pick.agentId) || undefined;
  const name = agentName(agentsResult, agentId) || str(pick.label) || "the Trunk";
  return { sessionKey: str(pick.key), ...(agentId ? { agentId } : {}), name };
}

/** Loads the session Take over should pause. */
export function useHoldTarget(link: EngineLink): HoldTarget | null {
  const [target, setTarget] = useState<HoldTarget | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const list = await link.request("sessions.list", {});
      let agents: unknown;
      try {
        agents = await link.request("agents.list", {});
      } catch {
        agents = undefined;
      }
      if (live) setTarget(pickHoldSession(list, agents));
    })().catch(() => {
      if (live) setTarget(null);
    });
    return () => {
      live = false;
    };
  }, [link]);
  return target;
}
