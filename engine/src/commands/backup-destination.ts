// Branch: where Settings › Backups sends the scheduled Git backup. A folder on this computer is the
// backup repository itself; a Git repository (a URL, or a bare repository path) gets a private local
// copy beside the state directory that pushes to the repository's `backups` branch.
import { createHash } from "node:crypto";
import path from "node:path";
import { redactSensitiveUrlLikeString } from "@branch/net-policy/redact-sensitive-url";
import { executeGitCommand, requireGitCommand } from "../infra/git-exec.js";
import { initializeGitBackupRepository } from "../snapshot/git-backup.js";

export type BackupDestination = { kind: "folder"; path: string } | { kind: "git"; url: string };

/** The remote branch Branch pushes backups to, so one private repository can also hold other work. */
export const BACKUP_REMOTE_BRANCH = "backups";

/** Never prompt for a sign-in from the Gateway; the person's Git sign-in (credential helper) is used. */
const NON_INTERACTIVE_GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

/** Reject a sign-in written into the address: it would be stored in the repository's config. */
export function assertNoCredentialsInUrl(url: string): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    parsed = undefined;
  }
  if (parsed && /^https?:$/.test(parsed.protocol) && (parsed.username || parsed.password)) {
    throw new Error(
      "Leave the sign-in out of the repository address. Branch uses your Git sign-in instead.",
    );
  }
}

/**
 * The local copy for a Git destination: one folder per repository, beside the state directory
 * (for example ~/.branch-backup-1a2b3c4d5e6f). It sits directly in the state directory's parent so
 * the repository privacy check sees only the person's own folders above it.
 */
export function resolveGitDestinationRepository(stateDir: string, url: string): string {
  const id = createHash("sha256").update(url).digest("hex").slice(0, 12);
  return `${path.resolve(stateDir)}-backup-${id}`;
}

async function git(repositoryPath: string, args: string[]) {
  return await executeGitCommand(repositoryPath, args, { env: NON_INTERACTIVE_GIT_ENV });
}

/** A fresh local copy starts on `backups` and adopts the remote's history when it already has one. */
async function adoptRemoteBranch(repositoryPath: string, url: string): Promise<void> {
  const head = await git(repositoryPath, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const remote = await git(repositoryPath, [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${BACKUP_REMOTE_BRANCH}`,
  ]);
  if (remote.code !== 0) {
    const detail = redactSensitiveUrlLikeString(remote.stderr.trim()).slice(0, 300);
    throw new Error(
      `Branch couldn't reach ${redactSensitiveUrlLikeString(url)}. Check the address and your Git sign-in.${detail ? ` ${detail}` : ""}`,
    );
  }
  if (head.code === 0) {
    return;
  }
  await requireGitCommand(repositoryPath, [
    "symbolic-ref",
    "HEAD",
    `refs/heads/${BACKUP_REMOTE_BRANCH}`,
  ]);
  if (remote.stdout.trim()) {
    await requireGitCommand(repositoryPath, ["fetch", "origin", BACKUP_REMOTE_BRANCH], {
      env: NON_INTERACTIVE_GIT_ENV,
    });
    await requireGitCommand(repositoryPath, ["reset", "--hard", "FETCH_HEAD"]);
  }
}

/** Create or adopt the backup repository for a destination; returns how scheduled runs use it. */
export async function prepareBackupDestination(
  destination: BackupDestination,
  stateDir: string,
): Promise<{ repository: string; push: boolean }> {
  if (destination.kind === "folder") {
    const repository = path.resolve(destination.path.trim());
    await initializeGitBackupRepository({ repositoryPath: repository, stateDir });
    return { repository, push: false };
  }
  const url = destination.url.trim();
  if (!url) {
    throw new Error("Enter the repository address.");
  }
  assertNoCredentialsInUrl(url);
  const repository = resolveGitDestinationRepository(stateDir, url);
  await initializeGitBackupRepository({ repositoryPath: repository, stateDir, remote: url });
  await adoptRemoteBranch(repository, url);
  return { repository, push: true };
}

/** The pushed-to address of a backup repository, without any sign-in it may carry. */
export async function readBackupRemote(repository: string): Promise<string | undefined> {
  const result = await git(repository, ["remote", "get-url", "origin"]);
  const url = result.code === 0 ? result.stdout.trim() : "";
  return url ? redactSensitiveUrlLikeString(url) : undefined;
}
