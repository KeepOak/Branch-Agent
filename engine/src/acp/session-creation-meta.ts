import { RequestError } from "@agentclientprotocol/sdk";
// Ported from aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:
// crates/goose/src/acp/server/new_session.rs (NewSessionMetaFields, new_session_meta_fields, apply_initial_session_config).
import type { GatewayClient } from "../gateway/client.js";

export type AcpSessionCreationMeta = {
  projectId?: string;
  sessionTitle?: string;
  sessionType?: "user" | "acp" | "hidden";
};
export type AcpCreatedSession = { sessionKey: string; cwd: string };

/** Goose meta_string: absent/null are optional; a present non-string is invalid. */
function readCreationString(meta: Record<string, unknown>, key: string): string | undefined {
  const value = meta[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw RequestError.invalidParams({ field: key }, `${key} must be a string`);
  }
  return value;
}

export function readAcpSessionCreationMeta(value: unknown): AcpSessionCreationMeta {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { sessionType: "acp" };
  }
  const meta = value as Record<string, unknown>;
  const sessionType = readSessionType(meta);
  const sessionTitle = readCreationString(meta, "sessionTitle")?.trim() || undefined;
  const projectId = readCreationString(meta, "projectId");
  return {
    sessionType,
    ...(projectId !== undefined ? { projectId } : {}),
    ...(sessionTitle ? { sessionTitle } : {}),
  };
}

/** Goose session_type_from_meta: hidden short-circuits client; any client string selects User. */
function readSessionType(
  meta: Record<string, unknown>,
): NonNullable<AcpSessionCreationMeta["sessionType"]> {
  const hidden = meta.hidden;
  if (hidden !== undefined && hidden !== null && typeof hidden !== "boolean") {
    throw RequestError.invalidParams({ field: "hidden" }, "hidden must be a boolean");
  }
  if (hidden === true) {
    return "hidden";
  }
  return readCreationString(meta, "client") !== undefined ? "user" : "acp";
}

/** Use the existing authorized creation route so project placement and titles are durable. */
export async function persistAcpSessionCreationMeta(
  gateway: Pick<GatewayClient, "request">,
  sessionKey: string,
  cwd: string,
  meta: AcpSessionCreationMeta,
): Promise<AcpCreatedSession> {
  const result = await gateway.request<{
    ok: boolean;
    key: string;
    entry?: { spawnedCwd?: string; sessionRoot?: string };
  }>("sessions.create", {
    key: sessionKey,
    sessionType: meta.sessionType ?? "acp",
    // The native project route owns placement; raw cwd cannot accompany projectId.
    ...(meta.projectId !== undefined ? { projectId: meta.projectId } : { cwd }),
    ...(meta.sessionTitle !== undefined ? { displayName: meta.sessionTitle } : {}),
  });
  if (result?.ok !== true || typeof result.key !== "string" || !result.key.trim()) {
    throw new Error("ACP session metadata creation did not return a session key");
  }
  // Native creation/adoption owns project placement; prompts and provenance must match it.
  const nativeCwd = result.entry?.spawnedCwd ?? result.entry?.sessionRoot;
  return {
    sessionKey: result.key,
    cwd: typeof nativeCwd === "string" && nativeCwd.trim() ? nativeCwd : cwd,
  };
}
