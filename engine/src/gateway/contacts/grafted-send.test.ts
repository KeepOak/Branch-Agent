// A message to a joined Branch's Trunk must reach that Branch's queue, and each refusal must say which check failed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import { claimGraftWork } from "./graft-work.js";
import {
  DISCONNECTED_MESSAGE,
  isJoinedTeammateKey,
  NOT_LINKED_MESSAGE,
  queueGraftedTeammateSend,
  routeJoinedTeammateChat,
  teammateThreadKey,
} from "./grafted-send.js";
import { recordOutsideAgent, updateOutsideAgentSettings } from "./outside-agents.js";

const cfg = {
  agents: { entries: { juniper: {} } },
  tools: { agentToAgent: { enabled: true } },
} as BranchConfig;

let stateDir = "";
const previousState = process.env.BRANCH_STATE_DIR;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-grafted-send-"));
  process.env.BRANCH_STATE_DIR = stateDir;
  recordOutsideAgent({ id: "branch-nas", name: "NAS Builders", kind: "branch" }, Date.now(), undefined, {
    deviceId: "dev-nas",
  });
  recordOutsideAgent(
    { id: "branch-nas--builder-1", name: "Builder 1", kind: "trunk", via: "branch-nas", trunkId: "builder-1" },
    Date.now(),
    undefined,
    { deviceId: "dev-nas" },
  );
});
afterEach(() => {
  if (previousState === undefined) delete process.env.BRANCH_STATE_DIR;
  else process.env.BRANCH_STATE_DIR = previousState;
  // Windows can keep the state files open after a test; the OS clears that temp directory later.
  try {
    fs.rmSync(stateDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }
});

describe("messages to a joined Branch's Trunk", () => {
  it("recognises the contact key of a joined Trunk and nothing else", () => {
    expect(isJoinedTeammateKey("a2a:branch-nas--builder-1")).toBe(true);
    expect(isJoinedTeammateKey("agent:juniper:main")).toBe(false);
    expect(isJoinedTeammateKey("a2a:claude-code-04a06a")).toBe(false);
  });

  it("a send from a local chat reaches the remote Branch's queue, with the text and the Trunk", () => {
    const sent = queueGraftedTeammateSend({
      target: "a2a:branch-nas--builder-1",
      text: "  Ping from the Mac  ",
      sourceSessionKey: "agent:juniper:main",
      idempotencyKey: "chat-1",
      cfg,
    });
    expect(sent.ok).toBe(true);
    expect(claimGraftWork("dev-nas")).toMatchObject({
      id: sent.ok ? sent.id : "",
      trunkId: "builder-1",
      text: "Ping from the Mac",
      sourceAgentId: "juniper",
    });
    expect(claimGraftWork("dev-other")).toBeUndefined();
  });

  it("says a Trunk with no link is no longer linked, and queues nothing", () => {
    const sent = queueGraftedTeammateSend({
      target: "a2a:branch-nas--gone",
      text: "Ping",
      sourceSessionKey: "agent:juniper:main",
      cfg,
    });
    expect(sent).toEqual({ ok: false, code: "INVALID_REQUEST", message: NOT_LINKED_MESSAGE });
    expect(claimGraftWork("dev-nas")).toBeUndefined();
  });

  it("says a disconnected Branch was disconnected, not that the link is lost", () => {
    updateOutsideAgentSettings({ id: "branch-nas", revoked: true });
    const sent = queueGraftedTeammateSend({
      target: "a2a:branch-nas--builder-1",
      text: "Ping",
      sourceSessionKey: "agent:juniper:main",
      cfg,
    });
    expect(sent).toEqual({ ok: false, code: "INVALID_REQUEST", message: DISCONNECTED_MESSAGE });
  });

  it("a chat to a joined Trunk is queued with the owner's thread for that contact as its reply home", () => {
    const sent = routeJoinedTeammateChat({
      sessionKey: "a2a:branch-nas--builder-1",
      message: "Hello",
      idempotencyKey: "chat-9",
      defaultAgentId: "juniper",
      cfg,
      client: { connect: { scopes: ["operator.admin"], device: { id: "owner-dev" } } },
    });
    expect(sent.ok).toBe(true);
    expect(teammateThreadKey("juniper", "a2a:branch-nas--builder-1")).toBe("agent:juniper:a2a:branch-nas--builder-1");
    expect(claimGraftWork("dev-nas")).toMatchObject({
      trunkId: "builder-1",
      text: "Hello",
      sourceAgentId: "juniper",
    });
  });

  it("refuses a chat sent through a joined Branch's own device", () => {
    const sent = routeJoinedTeammateChat({
      sessionKey: "a2a:branch-nas--builder-1",
      message: "Hello",
      defaultAgentId: "juniper",
      cfg,
      client: { connect: { scopes: ["operator.read", "operator.write"], device: { id: "dev-nas" } } },
    });
    expect(sent).toEqual({ ok: false, code: "FORBIDDEN", message: "A joined Branch cannot message a teammate." });
  });
});
