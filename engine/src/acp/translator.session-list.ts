import path from "node:path";
import { RequestError } from "@agentclientprotocol/sdk";
import { readMetadataNumber } from "@branch/acp-core/meta";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";

const ACP_LIST_SESSIONS_DEFAULT_PAGE_SIZE = 100;
const ACP_LIST_SESSIONS_MAX_PAGE_SIZE = 100;
const ACP_LIST_SESSIONS_MAX_CURSOR_OFFSET = 10_000;

/** Maximum rows fetched to satisfy ACP session-list pagination plus next-page detection. */
export const ACP_LIST_SESSIONS_MAX_FETCH_LIMIT =
  ACP_LIST_SESSIONS_MAX_CURSOR_OFFSET + ACP_LIST_SESSIONS_MAX_PAGE_SIZE + 1;

type ListSessionsCursor = {
  offset: number;
  cwd?: string;
  types?: AcpVisibleSessionType[];
};

export const ACP_VISIBLE_SESSION_TYPES = ["user", "scheduled", "acp"] as const;
type AcpVisibleSessionType = (typeof ACP_VISIBLE_SESSION_TYPES)[number];

/** Pinned Goose ACP list allows only user/scheduled/acp and defaults empty/null to all three. */
export function readAcpSessionListTypes(
  meta: Record<string, unknown> | null | undefined,
): AcpVisibleSessionType[] {
  const value = meta?.types;
  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
    return [...ACP_VISIBLE_SESSION_TYPES];
  }
  if (
    !Array.isArray(value) ||
    value.some((type) => !ACP_VISIBLE_SESSION_TYPES.some((allowed) => allowed === type))
  ) {
    throw RequestError.invalidParams(
      { field: "types" },
      "types may only include user, scheduled, or acp",
    );
  }
  return [...new Set(value as AcpVisibleSessionType[])].toSorted();
}

export function assertListSessionsTypeFilter(
  cursor: ListSessionsCursor,
  types: AcpVisibleSessionType[],
): void {
  const canonical = (value: readonly AcpVisibleSessionType[]) => JSON.stringify(value.toSorted());
  if (canonical(cursor.types ?? ACP_VISIBLE_SESSION_TYPES) !== canonical(types)) {
    throw RequestError.invalidParams(
      { field: "types" },
      "ACP session list cursor does not match the type filter.",
    );
  }
}

export function encodeListSessionsCursor(cursor: ListSessionsCursor): string {
  const normalized = { ...cursor, ...(cursor.types ? { types: cursor.types.toSorted() } : {}) };
  return Buffer.from(JSON.stringify({ v: 1, ...normalized }), "utf8").toString("base64url");
}

export function decodeListSessionsCursor(value: string | null | undefined): ListSessionsCursor {
  if (value === null || value === undefined) {
    return { offset: 0 };
  }
  const record = readListSessionsCursorRecord(value);
  if (record.v !== 1) {
    throw new Error("Unsupported ACP session list cursor.");
  }
  if (
    typeof record.offset !== "number" ||
    !Number.isSafeInteger(record.offset) ||
    record.offset < 0 ||
    record.offset > ACP_LIST_SESSIONS_MAX_CURSOR_OFFSET
  ) {
    throw new Error("Invalid ACP session list cursor offset.");
  }
  const cwd = normalizeOptionalString(record.cwd);
  const cursor = {
    offset: record.offset,
    ...(cwd ? { cwd } : {}),
    ...(record.types !== undefined
      ? { types: readAcpSessionListTypes({ types: record.types }) }
      : {}),
  };
  if (encodeListSessionsCursor(cursor) !== value) {
    throw new Error("Invalid ACP session list cursor.");
  }
  return cursor;
}

function readListSessionsCursorRecord(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) {
      throw new Error("non-canonical base64url");
    }
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid ACP session list cursor.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid ACP session list cursor.");
  }
  return parsed as Record<string, unknown>;
}

export function assertAbsoluteCwd(cwd: string, method: string): void {
  if (!path.isAbsolute(cwd)) {
    throw new Error(`ACP ${method} requires an absolute cwd.`);
  }
}

export function resolveListSessionsPageSize(
  meta: Record<string, unknown> | null | undefined,
): number {
  const requested = readMetadataNumber(meta, ["limit", "pageSize"]);
  if (requested === undefined) {
    return ACP_LIST_SESSIONS_DEFAULT_PAGE_SIZE;
  }
  return Math.min(ACP_LIST_SESSIONS_MAX_PAGE_SIZE, Math.max(1, Math.floor(requested)));
}
