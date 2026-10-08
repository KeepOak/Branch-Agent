/** Windows ACL remediation facade backed by fs-safe permission helpers. */
import {
  createIcaclsResetCommand,
  inspectWindowsAcl,
  type PermissionExec,
  type WindowsAclEntry,
} from "@openclaw/fs-safe/advanced";
import { readOwnerAndDacl, type PermissionCheck } from "@openclaw/fs-safe/permissions";

export {
  createIcaclsResetCommand,
  formatIcaclsResetCommand,
  type PermissionExec as ExecFn,
} from "@openclaw/fs-safe/advanced";

/** A Windows path whose ACL grants access beyond its owner, SYSTEM, and Administrators. */
export class WindowsAclViolationError extends Error {
  readonly reasons: readonly string[];
  readonly repairCommand: string | null;

  constructor(message: string, reasons: readonly string[], repairCommand: string | null) {
    super(message);
    this.name = "WindowsAclViolationError";
    this.reasons = reasons;
    this.repairCommand = repairCommand;
  }
}

/** True only for a verified Windows ACL limited to trusted principals. */
export function isOwnerOnlyWindowsAcl(permissions: PermissionCheck): boolean {
  return (
    permissions.ok &&
    permissions.source === "windows-acl" &&
    permissions.ownerTrusted === true &&
    !permissions.groupReadable &&
    !permissions.worldReadable &&
    !permissions.groupWritable &&
    !permissions.worldWritable
  );
}

const SID_PATTERN = /^\*?s-\d+-\d+(-\d+)+$/iu;

/** An untrusted ACL grant; `inherited` is undefined when the descriptor could not say. */
export type WindowsAclCulprit = WindowsAclEntry & { inherited?: boolean };

function principalName(principal: string): string {
  return SID_PATTERN.test(principal) ? principal.replace(/^\*/u, "").toUpperCase() : principal;
}

function describeAccess(entry: WindowsAclCulprit): string {
  const access = [entry.canRead ? "read" : "", entry.canWrite ? "write" : ""].filter(Boolean);
  const origin =
    entry.inherited === true
      ? " (inherited from the parent folder)"
      : entry.inherited === false
        ? " (explicit grant)"
        : "";
  return `${principalName(entry.principal)} can ${access.join(" and ") || "access"} ${entry.rawRights}${origin}`;
}

/**
 * Names each reason a path fails the owner-only policy. `entries` are the untrusted ACEs
 * from inspectWindowsAcl; the permission flags still name a failure when they are absent.
 */
export function describeWindowsAclViolations(
  permissions: PermissionCheck,
  entries: readonly WindowsAclCulprit[] = [],
): string[] {
  if (!permissions.ok) {
    // Inspection errors can quote command output; name the failure without echoing it.
    return ["the Windows ACL could not be verified"];
  }
  const reasons: string[] = [];
  if (permissions.source !== "windows-acl") {
    reasons.push(`permissions came from ${permissions.source}, not a Windows ACL`);
  }
  if (permissions.ownerTrusted !== true) {
    reasons.push(
      `owner ${permissions.ownerSid ?? "unknown"} is not the current user, SYSTEM, or Administrators`,
    );
  }
  reasons.push(...entries.map(describeAccess));
  if (entries.length === 0) {
    const flags = (
      [
        ["worldReadable", permissions.worldReadable],
        ["worldWritable", permissions.worldWritable],
        ["groupReadable", permissions.groupReadable],
        ["groupWritable", permissions.groupWritable],
      ] as const
    ).filter(([, set]) => set);
    if (flags.length > 0) {
      reasons.push(`ACL grants ${flags.map(([name]) => name).join(", ")}`);
    }
  }
  return reasons;
}

function quoteIcaclsArgument(value: string): string {
  return /^[\w*./\\:()-]+$/u.test(value) ? value : `"${value}"`;
}

/**
 * Resets a directory to owner + SYSTEM: removes inherited ACEs, replaces both grants, and
 * removes each named explicit grant. Pass only explicit grants: icacls rejects the whole
 * command when a removed SID no longer resolves, and /inheritance:r already drops inherited ones.
 */
export function createOwnerOnlyDirectoryAclCommand(
  directory: string,
  options: { env?: NodeJS.ProcessEnv; removePrincipals?: readonly string[] } = {},
): { command: string; args: string[]; display: string } | null {
  const reset = createIcaclsResetCommand(directory, { isDir: true, env: options.env });
  if (!reset) {
    return null;
  }
  const removals = [...new Set(options.removePrincipals ?? [])].flatMap((principal) => [
    "/remove:g",
    SID_PATTERN.test(principal) ? `*${principalName(principal)}` : principal,
  ]);
  return {
    command: reset.command,
    args: [...reset.args, ...removals],
    display: [reset.display, ...removals.map(quoteIcaclsArgument)].join(" "),
  };
}

/**
 * Applies the owner + SYSTEM directory ACL on Windows; elsewhere POSIX modes already apply.
 * Throws when the current user cannot be named.
 */
export async function hardenWindowsOwnerOnlyDirectory(
  directory: string,
  options: { exec: PermissionExec; env?: NodeJS.ProcessEnv },
): Promise<void> {
  if (process.platform !== "win32") {
    return;
  }
  const command = createOwnerOnlyDirectoryAclCommand(directory, { env: options.env });
  if (!command) {
    throw new Error("The current Windows user could not be resolved to secure a private folder.");
  }
  await options.exec(command.command, command.args);
}

/** Lists untrusted grants on a Windows path, marking which ones the parent folder supplied. */
export async function readWindowsAclCulprits(target: string): Promise<WindowsAclCulprit[]> {
  try {
    const acl = await inspectWindowsAcl(target);
    if (!acl.ok) {
      return [];
    }
    let inheritedBySid = new Map<string, boolean>();
    try {
      const descriptor = readOwnerAndDacl(target);
      if (descriptor.status === "supported") {
        inheritedBySid = new Map(
          descriptor.aces
            .filter((ace) => ace.aceType === "allow" && !ace.flags.inheritOnly)
            // One explicit grant for a SID is enough to need an explicit removal.
            .map((ace) => [ace.sid.toLowerCase(), ace.flags.inherited] as const)
            .toSorted(([, a], [, b]) => Number(b) - Number(a)),
        );
      }
    } catch {
      // Without descriptor flags the culprit is still named; only its origin is unknown.
    }
    const culprits: WindowsAclCulprit[] = [];
    for (const entry of [...acl.untrustedWorld, ...acl.untrustedGroup]) {
      const inherited = entry.sid ? inheritedBySid.get(entry.sid.toLowerCase()) : undefined;
      culprits.push(inherited === undefined ? entry : { ...entry, inherited });
    }
    return culprits;
  } catch {
    // The permission flags still name the failure.
    return [];
  }
}

/**
 * Builds the error for a directory that failed isOwnerOnlyWindowsAcl. It names each offending
 * ACL entry or flag and the icacls command that repairs it; it never includes file contents.
 */
export async function createWindowsAclViolationError(params: {
  directory: string;
  permissions: PermissionCheck;
  subject: string;
  alternative?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<WindowsAclViolationError> {
  const entries = params.permissions.ok ? await readWindowsAclCulprits(params.directory) : [];
  const reasons = describeWindowsAclViolations(params.permissions, entries);
  const repair = createOwnerOnlyDirectoryAclCommand(params.directory, {
    env: params.env,
    removePrincipals: entries
      .filter((entry) => entry.inherited === false)
      .map((entry) => entry.sid ?? entry.principal),
  });
  const alternative = params.alternative ?? "";
  const fix = repair
    ? `Fix it by running: ${repair.display}${alternative ? `, or ${alternative}` : ""}.`
    : alternative
      ? `${alternative.charAt(0).toUpperCase()}${alternative.slice(1)}.`
      : "";
  return new WindowsAclViolationError(
    `${params.subject} is not private to its owner: ${reasons.join("; ")}. ${fix}`.trim(),
    reasons,
    repair?.display ?? null,
  );
}
