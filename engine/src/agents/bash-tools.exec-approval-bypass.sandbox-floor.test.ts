// Sandbox exemption from the always-ask floor (security review of PR #1278, finding 6): only a
// sandbox that cannot write to host paths skips the floor. These call the bypass resolver only.
import { describe, expect, it } from "vitest";
import { resolveExecApprovalBypass } from "./bash-tools.exec-approval-bypass.js";
import { sandboxHasWritableHostMounts } from "./sandbox/writable-host-mounts.js";

function resolveSandbox(command: string, sandboxHostWritable?: boolean) {
  return resolveExecApprovalBypass({
    command,
    host: "sandbox",
    ask: "off",
    warnings: [],
    bypassHostApprovalFloors: false,
    elevatedMode: "off",
    modePolicy: { security: "full", ask: "off" },
    ...(sandboxHostWritable === undefined ? {} : { sandboxHostWritable }),
  } as Parameters<typeof resolveExecApprovalBypass>[0]);
}

describe("sandbox always-ask floor", () => {
  it("keeps the floor for a sandbox with host paths mounted read-write", () => {
    expect(resolveSandbox("rm -rf /etc/", true)).toMatchObject({
      ask: "always",
      bypassApprovals: false,
      floor: { description: expect.any(String) },
    });
  });

  it("still skips the floor for a sandbox with no writable host mount", () => {
    expect(resolveSandbox("rm -rf /etc/", false)).toMatchObject({ floor: null });
  });

  it.each([
    [{ workspaceAccess: "rw" }, true],
    [{ workspaceAccess: "ro" }, false],
    [{ workspaceAccess: "none", docker: { binds: ["/srv/data:/data"] } }, true],
    [{ workspaceAccess: "none", docker: { binds: ["/srv/data:/data:rw"] } }, true],
    [{ workspaceAccess: "none", docker: { binds: ["/srv/data:/data:ro"] } }, false],
    [{ workspaceAccess: "none", docker: { binds: ["/srv/data:/data:ro,z"] } }, false],
    [{ workspaceAccess: "none" }, false],
  ])("detects writable host mounts: %j -> %s", (sandbox, expected) => {
    expect(sandboxHasWritableHostMounts(sandbox)).toBe(expected);
  });
});
