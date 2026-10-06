import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertLockdownOff, isLockdownError, isLockdownOn, LOCKDOWN_MESSAGE, LockdownError, testing } from "./lockdown.js";
import { decideLockdownAdmission, isLockdownSwitchPatch } from "./lockdown-policy.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "./runtime-snapshot.js";

describe("Lockdown switch patch", () => {
  it("admits only the single global switch with raw and baseHash", () => {
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":true}}' })).toBe(true);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false}}', baseHash: "h" })).toBe(true);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false,"audit":{}}}' })).toBe(false);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false},"tools":{}}' })).toBe(false);
    expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":null}}' })).toBe(false);
    for (const extra of ["sessionKey", "deliveryContext", "note", "restartDelayMs", "replacePaths"]) {
      expect(isLockdownSwitchPatch({ raw: '{"security":{"lockdown":false}}', [extra]: "x" }), extra).toBe(false);
    }
  });

  it("never treats inherited object keys as allowed methods", () => {
    for (const method of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(decideLockdownAdmission({ method, params: {}, scope: "operator.admin", isOwner: () => true }).admitted).toBe(false);
    }
  });
});

describe("Lockdown state", () => {
  let dir: string;
  const previous = process.env.BRANCH_CONFIG_PATH;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lockdown-"));
    process.env.BRANCH_CONFIG_PATH = path.join(dir, "branch.json");
    testing.resetFileCache();
  });
  afterEach(() => {
    clearRuntimeConfigSnapshot();
    if (previous === undefined) delete process.env.BRANCH_CONFIG_PATH;
    else process.env.BRANCH_CONFIG_PATH = previous;
    testing.resetFileCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const write = (text: string, mtime: number) => {
    fs.writeFileSync(process.env.BRANCH_CONFIG_PATH!, text);
    fs.utimesSync(process.env.BRANCH_CONFIG_PATH!, mtime, mtime);
  };

  it("follows the running engine's committed config", () => {
    expect(isLockdownOn()).toBe(false);
    setRuntimeConfigSnapshot({ security: { lockdown: true } });
    expect(isLockdownOn()).toBe(true);
    expect(() => assertLockdownOff()).toThrow(LockdownError);
  });

  it("sees the switch in the config file even when this engine's committed config is stale (stepped-down P45 engine)", () => {
    setRuntimeConfigSnapshot({ security: { lockdown: false } });
    write('{ security: { lockdown: true } }', 1_000);
    expect(isLockdownOn()).toBe(true);
    write('{ security: { lockdown: false } }', 2_000);
    expect(isLockdownOn()).toBe(false);
  });

  it("keeps the last good reading while the file is half-written", () => {
    write('{"security":{"lockdown":true}}', 1_000);
    expect(isLockdownOn()).toBe(true);
    write('{"security":{"lock', 2_000);
    expect(isLockdownOn()).toBe(true);
  });

  it("recognises a refusal after it was flattened to text", () => {
    expect(isLockdownError(new LockdownError())).toBe(true);
    expect(isLockdownError(`Error: ${LOCKDOWN_MESSAGE}`)).toBe(true);
    expect(isLockdownError(new Error("provider timeout"))).toBe(false);
  });
});
