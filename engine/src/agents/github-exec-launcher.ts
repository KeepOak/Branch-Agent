import { WindowsAclViolationError } from "../security/windows-acl.js";
import {
  GITHUB_EXEC_CREDENTIAL_UNAVAILABLE,
  readGitHubExecToken,
} from "./github-exec-credential.js";

// The shell bootstrap captures stdout privately; it must never become tool output.
// Keep this entrypoint free of runtime logging, worker IPC and credential caching.
async function resolveCredential() {
  const token = await readGitHubExecToken(process.argv[2] ?? "");
  process.stdout.write(token);
}

function credentialUnavailable(error?: unknown) {
  process.exitCode = 1;
  // An insecure folder ACL names its culprit and repair; every other cause stays generic.
  const message =
    error instanceof WindowsAclViolationError ? error.message : GITHUB_EXEC_CREDENTIAL_UNAVAILABLE;
  process.stderr.write(`${message}\n`);
}

// A cancelled private pipe must not turn a credential error into an uncaught stream stack.
process.stdout.on("error", () => credentialUnavailable());
process.stderr.on("error", () => {
  process.exitCode = 1;
});
void resolveCredential().catch(credentialUnavailable);
