// A second Branch grafted in as a scoped device: its hello rows are bound to its device, its messages must be
// its own, and Disconnect removes the whole device (its rows and its pairing, through device.pair.remove).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  graftDeviceId,
  graftSendRefusal,
  listOutsideAgents,
  outsideAgentDeviceRefusal,
  outsideAgentDeviceRows,
  readOutsideAgentSettings,
} from "../contacts/outside-agents.js";

const removed = vi.hoisted(() => ({ calls: [] as string[], fail: "" }));
const replyStep = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../agents/tools/agent-step.js", () => ({ runAgentStep: replyStep }));
vi.mock("../call.js", () => ({ callGateway: vi.fn() }));
vi.mock("../../mcp/graft-link.js", () => ({ ensureGraftLinks: vi.fn(() => ({ states: () => ({}) })) }));
vi.mock("./devices.js", () => ({
  deviceHandlers: {
    "device.pair.remove": async ({
      params,
      respond,
    }: {
      params: { deviceId: string };
      respond: (ok: boolean, payload?: unknown, error?: { message: string }) => void;
    }) => {
      removed.calls.push(params.deviceId);
      if (removed.fail) respond(false, undefined, { message: removed.fail });
      else respond(true, { deviceId: params.deviceId });
    },
  },
}));

const { contactHandlers } = await import("./contacts.js");
const { hasEventScope } = await import("../server-broadcast-scopes.js");

let stateDir = "";
const previousState = process.env.BRANCH_STATE_DIR;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-graft-contacts-"));
  process.env.BRANCH_STATE_DIR = stateDir;
  removed.calls = [];
  removed.fail = "";
});
afterEach(() => {
  if (previousState === undefined) delete process.env.BRANCH_STATE_DIR;
  else process.env.BRANCH_STATE_DIR = previousState;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const device = (id: string) => ({
  connect: { scopes: ["operator.read", "operator.write"], device: { id } },
});
const owner = {
  connect: { scopes: ["operator.admin", "operator.read"], device: { id: "owner-dev" } },
};

async function call(method: string, params: Record<string, unknown>, client: unknown) {
  let reply: { ok: boolean; payload?: any; error?: { message?: string } } | undefined;
  await contactHandlers[method]!({
    params,
    client,
    context: { broadcast: () => undefined, getRuntimeConfig: () => ({}), logGateway: { warn: () => undefined, info: () => undefined } },
    respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      reply = { ok, payload, error };
    },
  } as never);
  return reply!;
}

const branchB = { id: "branch-b", name: "Branch B", kind: "branch" };
const scout = { id: "branch-b--scout", name: "Scout", kind: "trunk", via: "branch-b", trunkId: "scout" };

describe("Branch-to-Branch graft on the host", () => {
  it("exposes saved links and rejects malformed window join requests", async () => {
    expect((await call("graft.links.list", {}, owner)).payload).toEqual({ links: [] });
    const invalid = await call("graft.join", { code: "" }, owner);
    expect(invalid.ok).toBe(false);
    expect(invalid.error?.message).toContain("Enter a setup code");
  });
  it("forgets only a saved link from the joining Branch", async () => {
    const { saveGraftLink } = await import("../../mcp/graft-join.js");
    saveGraftLink({ url: "wss://first.example.test", name: "First", joinedAt: Date.now() });
    saveGraftLink({ url: "wss://second.example.test", name: "Second", joinedAt: Date.now() });
    expect((await call("graft.links.forget", { url: "wss://missing.example.test" }, owner)).ok).toBe(false);
    expect((await call("graft.links.forget", { url: "wss://first.example.test" }, owner)).payload).toEqual({ forgotten: "wss://first.example.test" });
    expect((await call("graft.links.list", {}, owner)).payload.links).toMatchObject([{ url: "wss://second.example.test" }]);
  });

  it("treats only non-admin device connections as grafted devices", () => {
    expect(graftDeviceId(device("dev-b"))).toBe("dev-b");
    expect(graftDeviceId(owner)).toBeUndefined();
    expect(graftDeviceId({ connect: { scopes: ["operator.read"] } })).toBeUndefined();
  });

  it("lists the joining Branch and its Trunks bound to its device", async () => {
    expect((await call("contacts.outside.hello", { agent: branchB }, device("dev-b"))).ok).toBe(
      true,
    );
    const trunk = await call("contacts.outside.hello", { agent: scout }, device("dev-b"));
    expect(trunk.payload.contact).toMatchObject({ id: "a2a:branch-b--scout", name: "Scout" });
    expect(listOutsideAgents().map((row) => [row.id, row.kind, row.via, row.deviceId])).toEqual(
      expect.arrayContaining([
        ["branch-b", "branch", undefined, "dev-b"],
        ["branch-b--scout", "trunk", "branch-b", "dev-b"],
      ]),
    );
    const listed = await call("contacts.outside.list", {}, owner);
    expect(listed.payload.agents.map((row: { id: string }) => row.id).toSorted()).toEqual([
      "branch-b",
      "branch-b--scout",
    ]);
  });

  it("routes a local Trunk's work to the joined device and accepts only its reply", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    await call("contacts.outside.hello", { agent: { ...scout, trunkId: "scout" } }, device("dev-b"));
    const sent = await call("graft.work.send", { target: "a2a:branch-b--scout", text: "Ping", sourceSessionKey: "agent:juniper:main", idempotencyKey: "send-1" }, owner);
    expect(sent.ok).toBe(true);
    expect((await call("graft.work.poll", {}, device("dev-c"))).ok).toBe(false);
    expect((await call("graft.work.poll", {}, device("dev-b"))).payload.job).toMatchObject({ id: sent.payload.id, trunkId: "scout", text: "Ping" });
    expect((await call("graft.work.complete", { id: sent.payload.id, reply: "forged" }, device("dev-c"))).ok).toBe(false);
    expect((await call("graft.work.complete", { id: sent.payload.id, reply: "PONG" }, device("dev-b"))).ok).toBe(true);
    expect(replyStep).toHaveBeenCalledWith(expect.objectContaining({ agentId: "juniper", sessionKey: "agent:juniper:main", message: "PONG" }));
  });

  it("refuses another device or the owner's tools taking a grafted Branch's rows", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    const other = await call("contacts.outside.hello", { agent: branchB }, device("dev-c"));
    expect(other.ok).toBe(false);
    expect(other.error?.message).toContain("already connected from another device");
    expect((await call("contacts.outside.hello", { agent: branchB }, owner)).ok).toBe(false);
    const stray = await call(
      "contacts.outside.hello",
      { agent: { ...scout, id: "branch-c--scout", via: "branch-b" } },
      device("dev-c"),
    );
    expect(stray.error?.message).toContain("through its own grafted Branch");
    expect(outsideAgentDeviceRefusal({ ...scout }, undefined, listOutsideAgents())).toContain(
      "through its own grafted Branch",
    );
  });

  it("lets a grafted Branch send only as itself or its Trunks; a paired phone keeps upstream's rules", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    expect(graftSendRefusal("branch-b", "dev-b")).toBeUndefined();
    expect(graftSendRefusal(undefined, "dev-b")).toContain("sends only as itself");
    expect(graftSendRefusal("claude-code-a1b2c3", "dev-b")).toContain("sends only as itself");
    expect(graftSendRefusal(undefined, "phone-dev")).toBeUndefined();
    expect(graftSendRefusal(undefined, undefined)).toBeUndefined();
  });

  it("Disconnect removes the grafted Branch's pairing and every row it said hello as", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    await call("contacts.outside.hello", { agent: scout }, device("dev-b"));
    expect(outsideAgentDeviceRows("branch-b--scout", listOutsideAgents())?.deviceId).toBe("dev-b");
    const result = await call("contacts.outside.set", { id: "branch-b", revoked: true }, owner);
    expect(result.ok).toBe(true);
    expect(removed.calls).toEqual(["dev-b"]);
    expect(readOutsideAgentSettings().revoked.toSorted()).toEqual(["branch-b", "branch-b--scout"]);
    // Its pairing is gone (device.pair.remove above), so it cannot connect to say hello again until the owner
    // approves a new setup code; that re-pair is the next case. Other agents' tools cannot speak as it meanwhile.
    expect((await call("contacts.outside.hello", { agent: branchB }, owner)).ok).toBe(false);
  });

  it("a re-paired Branch takes its rows back after Disconnect, from the same or a new device", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    await call("contacts.outside.hello", { agent: scout }, device("dev-b"));
    await call("contacts.outside.set", { id: "branch-b", revoked: true }, owner);
    // The owner's own clients still cannot take released rows.
    expect((await call("contacts.outside.hello", { agent: branchB }, owner)).ok).toBe(false);
    // A new setup code, approved: the same Branch (same identity) says hello again.
    expect((await call("contacts.outside.hello", { agent: branchB }, device("dev-b"))).ok).toBe(
      true,
    );
    expect((await call("contacts.outside.hello", { agent: scout }, device("dev-b"))).ok).toBe(true);
    expect(readOutsideAgentSettings().revoked).toEqual([]);
    // Disconnected again, it re-joins from a fresh state dir (a new device): the rows move to that device.
    await call("contacts.outside.set", { id: "branch-b", revoked: true }, owner);
    expect((await call("contacts.outside.hello", { agent: branchB }, device("dev-b2"))).ok).toBe(
      true,
    );
    expect((await call("contacts.outside.hello", { agent: scout }, device("dev-b2"))).ok).toBe(
      true,
    );
    expect(listOutsideAgents().map((row) => row.deviceId)).toEqual(["dev-b2", "dev-b2"]);
    expect(readOutsideAgentSettings().revoked).toEqual([]);
    // A connected Branch's rows are not released: another device still cannot take them.
    expect((await call("contacts.outside.hello", { agent: branchB }, device("dev-c"))).ok).toBe(
      false,
    );
  });

  it("Settings › Grafts hears contacts.changed (it reloads on it), and a grafted Branch's read scope does too", () => {
    const reader = { connect: { role: "operator", scopes: ["operator.read"] } };
    expect(hasEventScope(reader as never, "contacts.changed")).toBe(true);
    expect(hasEventScope({ connect: { role: "operator", scopes: [] } } as never, "contacts.changed")).toBe(false);
  });

  it("keeps the rows connected when the pairing could not be removed", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    removed.fail = "missing scope: operator.pairing";
    const result = await call("contacts.outside.set", { id: "branch-b", revoked: true }, owner);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("operator.pairing");
    expect(readOutsideAgentSettings().revoked).toEqual([]);
  });

  it("refuses a grafted Trunk hello without a trunkId, so no unroutable row is kept", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    const bad = await call(
      "contacts.outside.hello",
      { agent: { id: "branch-b--ghost", name: "Ghost", kind: "trunk", via: "branch-b" } },
      device("dev-b"),
    );
    expect(bad.ok).toBe(false);
    expect(bad.error?.message).toContain("trunkId");
    expect(listOutsideAgents().map((row) => row.id)).not.toContain("branch-b--ghost");
  });

  it("says plainly that a teammate is no longer linked, not a raw lookup error", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    await call("contacts.outside.hello", { agent: { ...scout, trunkId: "scout" } }, device("dev-b"));
    const sent = await call(
      "graft.work.send",
      { target: "a2a:branch-b--gone", text: "Ping", sourceSessionKey: "agent:juniper:main", idempotencyKey: "gone-1" },
      owner,
    );
    expect(sent.ok).toBe(false);
    expect(sent.error?.message).toBe("That teammate isn't linked anymore. Link the Branch again.");
  });

  it("says a disconnected teammate was disconnected, which is a different fix from a lost link", async () => {
    await call("contacts.outside.hello", { agent: branchB }, device("dev-b"));
    await call("contacts.outside.hello", { agent: { ...scout, trunkId: "scout" } }, device("dev-b"));
    expect((await call("contacts.outside.set", { id: "branch-b", revoked: true }, owner)).ok).toBe(true);
    const sent = await call(
      "graft.work.send",
      { target: "a2a:branch-b--scout", text: "Ping", sourceSessionKey: "agent:juniper:main", idempotencyKey: "rev-1" },
      owner,
    );
    expect(sent.ok).toBe(false);
    expect(sent.error?.message).toContain("disconnected");
  });
});
