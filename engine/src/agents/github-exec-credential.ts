import fs from "node:fs/promises";
import path from "node:path";
import { inspectPathPermissions } from "@openclaw/fs-safe/permissions";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { parseDocument } from "yaml";
import { readSecureFile } from "../infra/fs-safe.js";
import {
  createWindowsAclViolationError,
  isOwnerOnlyWindowsAcl,
  WindowsAclViolationError,
} from "../security/windows-acl.js";

export const GITHUB_EXEC_CREDENTIAL_UNAVAILABLE =
  "GitHub Identity credential is unavailable or insecure. Reconnect or change GitHub Identity, then retry.";

async function privateProfileStat(profileDir: string) {
  const stat = await fs.lstat(profileDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
  }
  if (process.platform === "win32") {
    // Windows mode bits do not establish privacy; require verified owner-only ACL access.
    const permissions = await inspectPathPermissions(profileDir);
    if (!isOwnerOnlyWindowsAcl(permissions)) {
      // Name the offending ACL entry and its repair; the folder holds no secret in its name.
      throw await createWindowsAclViolationError({
        directory: profileDir,
        permissions,
        subject: "The GitHub Identity credential folder",
        alternative: "reconnect GitHub Identity, then retry",
      });
    }
  } else if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) {
    throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
  }
  return stat;
}

function credentialFailure(error: unknown): Error {
  // ACL errors are built only from ACL facts and the folder path. Never retain any other
  // filesystem/YAML cause: it may contain the credential or private paths.
  return error instanceof WindowsAclViolationError
    ? error
    : new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
}

/** Called only inside the local launcher, never by the Gateway or its supervision pipeline. */
export async function readGitHubExecToken(profileDir: string): Promise<string> {
  try {
    const profile = await privateProfileStat(profileDir);
    const realProfileDir = await fs.realpath(profileDir);
    const filePath = path.join(profileDir, "hosts.yml");
    // Reject FIFOs/devices before the secure reader opens them; its timeout bounds reads.
    const hosts = await fs.lstat(filePath);
    if (!hosts.isFile() || hosts.isSymbolicLink() || hosts.nlink !== 1) {
      throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
    }
    const snapshot = await readSecureFile({
      filePath,
      trust: { trustedDirs: [realProfileDir] },
      io: { maxBytes: 64 * 1024, timeoutMs: 5_000 },
    });
    try {
      const currentProfile = await privateProfileStat(profileDir);
      if (
        currentProfile.dev !== profile.dev ||
        currentProfile.ino !== profile.ino ||
        path.dirname(snapshot.realPath) !== realProfileDir ||
        snapshot.stat.nlink !== 1
      ) {
        throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
      }
      // Keep YAML diagnostics private, reject malformed documents, and disallow alias expansion.
      const document = parseDocument(snapshot.buffer.toString("utf8"), { prettyErrors: false });
      if (document.errors.length || document.warnings.length) {
        throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
      }
      const parsed: unknown = document.toJS({ maxAliasCount: 0 });
      const host = isRecord(parsed) ? parsed["github.com"] : undefined;
      const token =
        isRecord(host) && typeof host.oauth_token === "string" ? host.oauth_token.trim() : "";
      if (!token || /[\r\n\0]/u.test(token)) {
        throw new Error(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
      }
      return token;
    } finally {
      snapshot.buffer.fill(0);
    }
  } catch (error) {
    throw credentialFailure(error);
  }
}
