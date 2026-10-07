import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareHostRendezvous, resolveHostStateDir } from "./host-rendezvous.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function aclFacts(filePath: string): { protected: boolean; owner: string; user: string; sids: string[] } {
  const script = [
    "$acl = [IO.File]::GetAccessControl($env:HOST_TOKEN_PATH)",
    "$user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$sids = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value })",
    "@{ protected = $acl.AreAccessRulesProtected; owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; user = $user; sids = $sids } | ConvertTo-Json -Compress",
  ].join("; ");
  return JSON.parse(
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, HOST_TOKEN_PATH: filePath },
    }),
  ) as { protected: boolean; owner: string; user: string; sids: string[] };
}

describe.runIf(process.platform === "win32")("Windows host rendezvous token", () => {
  it("publishes a token with a protected owner DACL", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-host-windows-"));
    dirs.push(dir);
    const env = { ...process.env, BRANCH_GATEWAY_HOST_LOCK_DIR: dir };
    const host = await prepareHostRendezvous({
      env,
      profile: "default",
      home: dir,
      gatewayPort: 0,
      allowInTests: true,
    });
    try {
      const facts = aclFacts(path.join(resolveHostStateDir(env), "host-gateway.token"));
      expect(facts.protected).toBe(true);
      expect(facts.owner).toBe(facts.user);
      expect(facts.sids.toSorted()).toEqual([facts.user, "S-1-5-18", "S-1-5-32-544"].toSorted());
    } finally {
      await host.close?.();
    }
  });

  it("keeps the token private when the rendezvous record is rewritten", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-host-windows-"));
    dirs.push(dir);
    const env = { ...process.env, BRANCH_GATEWAY_HOST_LOCK_DIR: dir };
    const host = await prepareHostRendezvous({
      env,
      profile: "default",
      home: dir,
      gatewayPort: 0,
      allowInTests: true,
    });
    try {
      const tokenPath = path.join(resolveHostStateDir(env), "host-gateway.token");
      execFileSync("icacls.exe", [tokenPath, "/grant", "*S-1-1-0:F"], {
        windowsHide: true,
      });
      expect(aclFacts(tokenPath).sids).toContain("S-1-1-0");
      await host.markReady?.();
      const facts = aclFacts(tokenPath);
      expect(facts.protected).toBe(true);
      expect(facts.sids).not.toContain("S-1-1-0");
    } finally {
      await host.close?.();
    }
  });
});
