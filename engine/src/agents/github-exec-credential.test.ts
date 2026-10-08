import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockProcessPlatform } from "../test-utils/vitest-spies.js";

const permissions = vi.hoisted(() => ({ inspect: vi.fn(), read: vi.fn(), acl: vi.fn() }));
vi.mock("@openclaw/fs-safe/permissions", () => ({
  inspectPathPermissions: permissions.inspect,
  readOwnerAndDacl: () => ({ status: "unsupported-platform", platform: "linux" }),
}));
vi.mock("@openclaw/fs-safe/advanced", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@openclaw/fs-safe/advanced")>()),
  inspectWindowsAcl: permissions.acl,
}));
vi.mock("../infra/fs-safe.js", () => ({ readSecureFile: permissions.read }));

import {
  GITHUB_EXEC_CREDENTIAL_UNAVAILABLE,
  readGitHubExecToken,
} from "./github-exec-credential.js";

let platformMock: ReturnType<typeof mockProcessPlatform> | undefined;
let profileDir: string;
const privateAcl = {
  ok: true,
  source: "windows-acl",
  ownerTrusted: true,
  worldReadable: false,
  groupReadable: false,
  worldWritable: false,
  groupWritable: false,
};

beforeEach(async () => {
  profileDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "github-exec-acl-")));
  // Windows admission must use ACLs, not Node's synthetic POSIX mode bits.
  await fs.chmod(profileDir, 0o755);
  const hosts = path.join(profileDir, "hosts.yml");
  await fs.writeFile(hosts, "github.com:\n  oauth_token: synthetic-windows-token\n", {
    mode: 0o600,
  });
  permissions.inspect.mockReset().mockResolvedValue(privateAcl);
  permissions.acl.mockReset().mockResolvedValue({ ok: false });
  permissions.read.mockReset().mockResolvedValue({
    buffer: Buffer.from("github.com:\n  oauth_token: synthetic-windows-token\n"),
    realPath: hosts,
    stat: await fs.stat(hosts),
  });
  platformMock = mockProcessPlatform("win32");
});

afterEach(async () => {
  platformMock?.mockRestore();
  platformMock = undefined;
  await fs.rm(profileDir, { recursive: true, force: true });
});

describe("GitHub exec Windows directory ownership", () => {
  it("accepts a private verified ACL without imposing POSIX permissions", async () => {
    await expect(readGitHubExecToken(profileDir)).resolves.toBe("synthetic-windows-token");
    expect(permissions.read).toHaveBeenCalledOnce();
  });

  it.each([
    { reason: "unverified", change: { ok: false }, culprit: "could not be verified" },
    {
      reason: "unknown source",
      change: { source: "unknown" },
      culprit: "permissions came from unknown, not a Windows ACL",
    },
    {
      reason: "different owner",
      change: { ownerTrusted: false, ownerSid: "S-1-5-21-7-7-7-1001" },
      culprit: "owner S-1-5-21-7-7-7-1001 is not the current user",
    },
    { reason: "group read", change: { groupReadable: true }, culprit: "ACL grants groupReadable" },
    { reason: "world read", change: { worldReadable: true }, culprit: "ACL grants worldReadable" },
    { reason: "group write", change: { groupWritable: true }, culprit: "ACL grants groupWritable" },
    { reason: "world write", change: { worldWritable: true }, culprit: "ACL grants worldWritable" },
  ])("rejects $reason before reading credentials and names it", async ({ change, culprit }) => {
    permissions.inspect.mockResolvedValue({ ...privateAcl, ...change });
    const error = await readGitHubExecToken(profileDir).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("The GitHub Identity credential folder is not private to its owner");
    expect(message).toContain(culprit);
    expect(message).toContain("Fix it by running:");
    expect(message).toContain("/inheritance:r");
    expect(message).toContain("reconnect GitHub Identity, then retry.");
    expect(permissions.read).not.toHaveBeenCalled();
  });

  it("names an inherited unknown SID and offers the reset that removes it", async () => {
    const sid = "s-1-5-21-4207584154-2468973234-499911298-475381888";
    const entry = {
      principal: sid,
      sid,
      rights: ["RD", "WD"],
      rawRights: "(RD,WD)",
      canRead: true,
      canWrite: true,
    };
    permissions.inspect.mockResolvedValue({ ...privateAcl, groupReadable: true });
    permissions.acl.mockResolvedValue({
      ok: true,
      entries: [entry],
      trusted: [],
      untrustedWorld: [],
      untrustedGroup: [entry],
    });

    await expect(readGitHubExecToken(profileDir)).rejects.toThrow(
      /S-1-5-21-4207584154-2468973234-499911298-475381888 can read and write \(RD,WD\)\. Fix it by running: .*icacls\.exe "[^"]+" \/inheritance:r \/grant:r "[^"]+:\(OI\)\(CI\)F" \/grant:r "\*S-1-5-18:\(OI\)\(CI\)F", or reconnect/u,
    );
    expect(permissions.acl).toHaveBeenCalledWith(profileDir);
    expect(permissions.read).not.toHaveBeenCalled();
  });

  it("keeps non-ACL failures generic so credential contents never escape", async () => {
    permissions.read.mockResolvedValue({
      buffer: Buffer.from("github.com: [synthetic-windows-token"),
      realPath: path.join(profileDir, "hosts.yml"),
      stat: await fs.stat(path.join(profileDir, "hosts.yml")),
    });
    const error = await readGitHubExecToken(profileDir).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(GITHUB_EXEC_CREDENTIAL_UNAVAILABLE);
    expect(JSON.stringify(error)).not.toContain("synthetic-windows-token");
  });

  it("rejects a directory ACL that changes while the file is being read", async () => {
    permissions.inspect
      .mockResolvedValueOnce(privateAcl)
      .mockResolvedValueOnce({ ...privateAcl, worldReadable: true });
    const error = await readGitHubExecToken(profileDir).catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("ACL grants worldReadable");
    expect((error as Error).message).not.toContain("synthetic-windows-token");
    expect(permissions.read).toHaveBeenCalledOnce();
  });
});
