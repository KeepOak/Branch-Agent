// Behaviour tests for atlas SAFETY-0200 / SAFETY-0118 (G-1680): naming the owner's chat account is explicit, and
// an owner already named (including one set by the earlier first-approval bootstrap) is never re-checked or removed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  source: {} as Record<string, unknown>,
  replaceConfigFile: vi.fn(async () => {}),
}));

vi.mock("../config/config.js", () => ({
  readConfigFileSnapshotForWrite: vi.fn(async () => ({
    snapshot: { sourceConfig: structuredClone(config.source) },
    writeOptions: {},
  })),
  replaceConfigFile: config.replaceConfigFile,
}));

import { addCommandOwnerAccount, bootstrapCommandOwnerFromPairing } from "./command-owner.js";

function written(): string[] | undefined {
  const call = config.replaceConfigFile.mock.calls.at(0) as unknown as
    | [{ sourceConfig: { commands?: { ownerAllowFrom?: string[] } } }]
    | undefined;
  return call?.[0].sourceConfig.commands?.ownerAllowFrom;
}

describe("G-1680 command owner naming", () => {
  beforeEach(() => {
    config.source = {};
    config.replaceConfigFile.mockClear();
  });

  it("G-1680: an owner already named by an earlier pairing bootstrap is kept untouched", async () => {
    config.source = { commands: { ownerAllowFrom: ["telegram:100"] } };
    expect(await bootstrapCommandOwnerFromPairing({ channel: "telegram", id: "200" })).toEqual({
      ownerEntry: "telegram:200",
      status: "already-configured",
    });
    expect(config.replaceConfigFile).not.toHaveBeenCalled();
  });

  it("G-1680: the owner saying 'this sender is me' names it when no owner is named yet", async () => {
    expect((await bootstrapCommandOwnerFromPairing({ channel: "telegram", id: "123" })).status).toBe("configured");
    expect(written()).toEqual(["telegram:123"]);
  });

  it("G-1680: linking another owner account adds it and never removes an existing one", async () => {
    config.source = { commands: { ownerAllowFrom: ["telegram:100"] } };
    expect((await addCommandOwnerAccount({ channel: "discord", id: "999" })).status).toBe("configured");
    expect(written()).toEqual(["telegram:100", "discord:999"]);
    config.replaceConfigFile.mockClear();
    config.source = { commands: { ownerAllowFrom: ["telegram:100"] } };
    expect((await addCommandOwnerAccount({ channel: "telegram", id: "100" })).status).toBe("already-configured");
    expect(config.replaceConfigFile).not.toHaveBeenCalled();
  });
});
