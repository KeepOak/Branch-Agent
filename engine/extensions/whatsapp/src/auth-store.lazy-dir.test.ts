import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID } from "branch/plugin-sdk/routing";
import { captureEnv } from "branch/plugin-sdk/test-env";
import { expect, it, vi } from "vitest";

it("resolves active-profile directories after import and preserves the legacy string export", async () => {
  const envSnapshot = captureEnv(["BRANCH_STATE_DIR", "BRANCH_OAUTH_DIR"]);
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-wa-profile-"));
  try {
    delete process.env.BRANCH_STATE_DIR;
    delete process.env.BRANCH_OAUTH_DIR;
    vi.resetModules();
    const authStore = await import("./auth-store.js");
    const accounts = await import("./accounts.js");

    process.env.BRANCH_STATE_DIR = stateDir;
    const expected = path.join(stateDir, "credentials", "whatsapp", DEFAULT_ACCOUNT_ID);
    expect(authStore.resolveDefaultWebAuthDir()).toBe(expected);
    expect(accounts.listWhatsAppAuthDirs({})).toEqual([
      path.join(stateDir, "credentials"),
      expected,
    ]);

    vi.resetModules();
    const profileAuthStore = await import("./auth-store.js");
    expect(profileAuthStore.WA_WEB_AUTH_DIR).toBe(expected);
    expect(typeof profileAuthStore.WA_WEB_AUTH_DIR).toBe("string");
  } finally {
    envSnapshot.restore();
    vi.resetModules();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
