import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { withFileLock } from "@openclaw/fs-safe/file-lock";
import { root as fsRoot } from "../infra/fs-safe.js";
import { writeTextAtomic } from "../infra/json-files.js";
import { isMissingExternalRule, type ExternalRuleLayout } from "./external-project-rules.files.js";
import { resolveWorkspaceStateIdentity } from "./workspace-state-identity.js";

export type ExternalRuleState = {
  cursor: Record<string, boolean>;
  windsurf: Record<string, boolean>;
};
export type ExternalRuleStateScope = {
  agentDir: string;
  workspace: string;
  assertCurrent?: () => void;
};

export function externalRuleStatePath(scope: ExternalRuleStateScope): string {
  return path.join(
    scope.agentDir,
    "rule-toggles",
    `${resolveWorkspaceStateIdentity(scope.workspace).workspaceKey}.json`,
  );
}

function validateState(value: unknown): ExternalRuleState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid external rule toggle state");
  const record = value as Record<string, unknown>;
  for (const provider of ["cursor", "windsurf"] as const) {
    const map = record[provider];
    if (
      !map ||
      typeof map !== "object" ||
      Array.isArray(map) ||
      Object.values(map).some((enabled) => typeof enabled !== "boolean")
    ) {
      throw new Error(`Invalid ${provider} rule toggle state`);
    }
  }
  return record as ExternalRuleState;
}

export async function readExternalRuleState(
  scope: ExternalRuleStateScope,
): Promise<ExternalRuleState> {
  scope.assertCurrent?.();
  try {
    const relative = path.relative(scope.agentDir, externalRuleStatePath(scope));
    const result = await (
      await fsRoot(scope.agentDir)
    ).read(relative, {
      symlinks: "reject",
      nonBlockingRead: true,
      maxBytes: Infinity,
    });
    scope.assertCurrent?.();
    return validateState(JSON.parse(result.buffer.toString("utf8")));
  } catch (error) {
    if (isMissingExternalRule(error)) return { cursor: {}, windsurf: {} };
    throw error;
  }
}

/** Synchronize every layout from the same map, then combine Cursor's locations. */
export function refreshExternalRuleState(
  state: ExternalRuleState,
  layouts: ExternalRuleLayout[],
): ExternalRuleState {
  const result: ExternalRuleState = { cursor: {}, windsurf: {} };
  for (const layout of layouts) {
    const previous = state[layout.provider];
    const entries = layout.error
      ? Object.keys(previous).filter(
          (key) => key === layout.source || key.startsWith(`${layout.source}/`),
        )
      : layout.files;
    for (const relative of entries) {
      Object.defineProperty(result[layout.provider], relative, {
        value: Object.hasOwn(previous, relative) ? previous[relative] : true,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

async function prepareStateDirectory(scope: ExternalRuleStateScope): Promise<string> {
  scope.assertCurrent?.();
  await fs.mkdir(scope.agentDir, { recursive: true, mode: 0o700 });
  const root = await fsRoot(scope.agentDir);
  await root.mkdir("rule-toggles", { private: true });
  const directory = await fs.realpath(path.join(scope.agentDir, "rule-toggles"));
  const parent = await fs.realpath(scope.agentDir);
  if (path.relative(parent, directory) !== "rule-toggles")
    throw new Error("Invalid rule state directory");
  scope.assertCurrent?.();
  return path.join(directory, path.basename(externalRuleStatePath(scope)));
}

export async function updateExternalRuleState(
  scope: ExternalRuleStateScope,
  update: (previous: ExternalRuleState) => ExternalRuleState,
): Promise<ExternalRuleState> {
  const filePath = await prepareStateDirectory(scope);
  return withFileLock(filePath, { payload: () => ({ pid: process.pid }) }, async () => {
    const previous = await readExternalRuleState(scope);
    scope.assertCurrent?.();
    const next = validateState(update(previous));
    if (!isDeepStrictEqual(previous, next)) {
      await writeTextAtomic(filePath, `${JSON.stringify(next)}\n`, {
        mode: 0o600,
        dirMode: 0o700,
        beforeRename: async () => {
          scope.assertCurrent?.();
          await readExternalRuleState(scope);
          if ((await prepareStateDirectory(scope)) !== filePath)
            throw new Error("Rule state directory changed");
          scope.assertCurrent?.();
        },
      });
    }
    return next;
  });
}
