// Applies the credential-folder ACL reset to a real Windows directory.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectPathPermissions } from "@openclaw/fs-safe/permissions";
import { afterEach, describe, expect, it } from "vitest";
import { runExec } from "../process/exec.js";
import {
  createWindowsAclViolationError,
  hardenWindowsOwnerOnlyDirectory,
  isOwnerOnlyWindowsAcl,
} from "./windows-acl.js";

let directory: string | undefined;

afterEach(async () => {
  if (directory) {
    await fs.rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe.runIf(process.platform === "win32")("Windows credential folder ACL", () => {
  it("names an untrusted grant, then passes the owner-only check after hardening", async () => {
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "branch-acl-"));
    directory = parent;
    // A child inherits the parent's grants, as a credential folder does from the state folder.
    await runExec("icacls.exe", [parent, "/grant", "*S-1-5-32-545:(OI)(CI)RX"]);
    const profile = path.join(parent, "ghp_fixture");
    await fs.mkdir(profile);

    const before = await inspectPathPermissions(profile);
    expect(isOwnerOnlyWindowsAcl(before)).toBe(false);
    const violation = await createWindowsAclViolationError({
      directory: profile,
      permissions: before,
      subject: "Folder",
    });
    expect(violation.reasons.join("\n")).toContain("S-1-5-32-545 can read");
    expect(violation.repairCommand).toContain("/inheritance:r");

    await hardenWindowsOwnerOnlyDirectory(profile, { exec: runExec });

    const after = await inspectPathPermissions(profile);
    expect(isOwnerOnlyWindowsAcl(after)).toBe(true);
  });
});
