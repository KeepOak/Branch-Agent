// Covers the Windows ACL remediation facade used by security fixes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";

const acl = vi.hoisted(() => ({ inspect: vi.fn(), descriptor: vi.fn() }));
vi.mock("@openclaw/fs-safe/advanced", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw/fs-safe/advanced")>()),
  inspectWindowsAcl: acl.inspect,
}));
vi.mock("@openclaw/fs-safe/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw/fs-safe/permissions")>()),
  readOwnerAndDacl: acl.descriptor,
}));

import {
  createIcaclsResetCommand,
  createOwnerOnlyDirectoryAclCommand,
  createWindowsAclViolationError,
  describeWindowsAclViolations,
  formatIcaclsResetCommand,
  hardenWindowsOwnerOnlyDirectory,
  isOwnerOnlyWindowsAcl,
} from "./windows-acl.js";

const DEFAULT_ICACLS = "C:\\Windows\\System32\\icacls.exe";

describe("windows ACL remediation", () => {
  it("builds a file reset command for the current principal and SYSTEM", () => {
    const command = createIcaclsResetCommand("C:\\test\\file.txt", {
      isDir: false,
      env: {
        SystemRoot: "C:\\Windows",
        USERNAME: "TestUser",
        USERDOMAIN: "WORKGROUP",
      },
    });

    expect(command).toMatchObject({
      command: DEFAULT_ICACLS,
      args: [
        "C:\\test\\file.txt",
        "/inheritance:r",
        "/grant:r",
        "WORKGROUP\\TestUser:F",
        "/grant:r",
        "*S-1-5-18:F",
      ],
    });
  });

  it("adds inheritance flags for directory remediation", () => {
    const display = formatIcaclsResetCommand("C:\\test\\dir", {
      isDir: true,
      env: { SystemRoot: "C:\\Windows", USERNAME: "TestUser" },
    });

    expect(display).toContain("(OI)(CI)F");
    expect(display).toContain("*S-1-5-18:(OI)(CI)F");
  });

  it("uses a validated SystemRoot for the executable", () => {
    const command = createIcaclsResetCommand("C:\\test\\file.txt", {
      isDir: false,
      env: { SystemRoot: "D:\\Windows", USERNAME: "TestUser" },
    });

    expect(command?.command).toBe("D:\\Windows\\System32\\icacls.exe");
  });

  it("returns null when no user principal can be resolved", () => {
    const command = createIcaclsResetCommand("C:\\test\\file.txt", {
      isDir: false,
      env: { USERNAME: "", USERDOMAIN: "" },
      userInfo: () => ({ username: "" }),
    });

    expect(command).toBeNull();
  });
});

const ENV = { SystemRoot: "C:\\Windows", USERNAME: "TestUser", USERDOMAIN: "WORKGROUP" };
const PROFILE = "C:\\state\\credentials\\github\\system\\ghp_fixture";
const UNKNOWN_SID = "s-1-5-21-1000-2000-3000-4001";
const privateAcl = {
  ok: true,
  isSymlink: false,
  isDir: true,
  mode: null,
  bits: null,
  source: "windows-acl" as const,
  ownerTrusted: true,
  worldReadable: false,
  groupReadable: false,
  worldWritable: false,
  groupWritable: false,
};
const unknownSidEntry = {
  principal: UNKNOWN_SID,
  sid: UNKNOWN_SID,
  rights: ["RD", "WD"],
  rawRights: "(RD,WD)",
  canRead: true,
  canWrite: true,
};
const ace = (sid: string, inherited: boolean) => ({
  sid,
  mask: 0x1_01bf,
  aceType: "allow",
  flags: { inherited, inheritOnly: false },
});

describe("owner-only credential folder ACLs", () => {
  beforeEach(() => {
    acl.inspect.mockReset().mockResolvedValue({
      ok: true,
      entries: [unknownSidEntry],
      trusted: [],
      untrustedWorld: [],
      untrustedGroup: [unknownSidEntry],
    });
    acl.descriptor.mockReset().mockReturnValue({
      status: "supported",
      aces: [ace(UNKNOWN_SID, true), ace("s-1-5-18", true)],
    });
  });

  it("admits only a verified ACL limited to trusted principals", () => {
    expect(isOwnerOnlyWindowsAcl(privateAcl)).toBe(true);
    for (const change of [
      { ok: false },
      { source: "unknown" as const },
      { ownerTrusted: false },
      { groupReadable: true },
      { worldReadable: true },
      { groupWritable: true },
      { worldWritable: true },
    ]) {
      expect(isOwnerOnlyWindowsAcl({ ...privateAcl, ...change })).toBe(false);
    }
  });

  it("names an inherited unknown SID and offers the owner + SYSTEM reset", async () => {
    const error = await createWindowsAclViolationError({
      directory: PROFILE,
      permissions: { ...privateAcl, groupReadable: true, groupWritable: true },
      subject: "The GitHub Identity credential folder",
      alternative: "reconnect GitHub Identity, then retry",
      env: ENV,
    });

    expect(error.reasons).toEqual([
      "S-1-5-21-1000-2000-3000-4001 can read and write (RD,WD) (inherited from the parent folder)",
    ]);
    expect(error.repairCommand).toBe(
      `C:\\Windows\\System32\\icacls.exe "${PROFILE}" /inheritance:r /grant:r "WORKGROUP\\TestUser:(OI)(CI)F" /grant:r "*S-1-5-18:(OI)(CI)F"`,
    );
    expect(error.message).toBe(
      `The GitHub Identity credential folder is not private to its owner: ${error.reasons[0]}. ` +
        `Fix it by running: ${error.repairCommand}, or reconnect GitHub Identity, then retry.`,
    );
    expect(acl.inspect).toHaveBeenCalledWith(PROFILE);
  });

  it("removes an explicit untrusted grant that disabling inheritance would keep", async () => {
    acl.descriptor.mockReturnValue({
      status: "supported",
      aces: [ace(UNKNOWN_SID, true), ace(UNKNOWN_SID, false)],
    });

    const error = await createWindowsAclViolationError({
      directory: PROFILE,
      permissions: { ...privateAcl, groupReadable: true },
      subject: "Folder",
      env: ENV,
    });

    expect(error.reasons[0]).toContain("(explicit grant)");
    expect(error.repairCommand).toMatch(/ \/remove:g \*S-1-5-21-1000-2000-3000-4001$/u);
  });

  it("names permission flags and an untrusted owner when ACEs cannot be listed", async () => {
    acl.inspect.mockRejectedValue(new Error("C:\\private\\path failed"));

    const error = await createWindowsAclViolationError({
      directory: PROFILE,
      permissions: {
        ...privateAcl,
        ownerTrusted: false,
        ownerSid: "S-1-5-21-9-9-9-500",
        worldReadable: true,
      },
      subject: "Folder",
      env: ENV,
    });

    expect(error.reasons).toEqual([
      "owner S-1-5-21-9-9-9-500 is not the current user, SYSTEM, or Administrators",
      "ACL grants worldReadable",
    ]);
    expect(error.message).not.toContain("private\\path");
  });

  it("reports an unverifiable ACL without echoing the inspection error", () => {
    expect(
      describeWindowsAclViolations({
        ...privateAcl,
        ok: false,
        source: "unknown",
        error: "icacls output with C:\\secret\\path",
      }),
    ).toEqual(["the Windows ACL could not be verified"]);
    expect(describeWindowsAclViolations({ ...privateAcl, source: "unknown" })).toEqual([
      "permissions came from unknown, not a Windows ACL",
    ]);
  });

  it("hardens a directory with the reset command and no removals", async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => ({ stdout: "", stderr: "" }));
    const platform = mockProcessPlatform("win32");
    try {
      await hardenWindowsOwnerOnlyDirectory(PROFILE, { exec, env: ENV });
    } finally {
      platform.mockRestore();
    }

    expect(exec).toHaveBeenCalledExactlyOnceWith("C:\\Windows\\System32\\icacls.exe", [
      PROFILE,
      "/inheritance:r",
      "/grant:r",
      "WORKGROUP\\TestUser:(OI)(CI)F",
      "/grant:r",
      "*S-1-5-18:(OI)(CI)F",
    ]);
    expect(createOwnerOnlyDirectoryAclCommand(PROFILE, { env: ENV })?.args).toEqual(
      exec.mock.calls[0]?.[1],
    );
  });

  it("leaves POSIX directories to their mode bits", async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => ({ stdout: "", stderr: "" }));
    const platform = mockProcessPlatform("linux");
    try {
      await hardenWindowsOwnerOnlyDirectory(PROFILE, { exec, env: ENV });
    } finally {
      platform.mockRestore();
    }
    expect(exec).not.toHaveBeenCalled();
  });
});
