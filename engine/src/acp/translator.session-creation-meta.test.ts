// Native caller cases for Goose session/new metadata, adapted to Branch's existing Gateway authority.
import { createInMemorySessionStore } from "@branch/acp-core/session";
import { expect, it, vi } from "vitest";
import type { GatewayClient } from "../gateway/client.js";
import { createNewSessionRequest } from "./translator.bridge-test-helpers.js";
import {
  createAcpConnection,
  createAcpGateway,
  createAcpGatewayAgent,
} from "./translator.test-helpers.js";

vi.mock("./commands.js", () => ({ getAvailableCommands: () => [] }));

function fixture(deny = false) {
  const row = { key: "agent:main:canonical", projectId: "", displayName: "" };
  const sessionStore = createInMemorySessionStore();
  const connection = createAcpConnection();
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "sessions.create") {
      if (deny) {
        throw new Error("missing operator.write");
      }
      row.projectId = String(params.projectId ?? "");
      row.displayName = String(params.displayName ?? "");
      return {
        ok: true,
        key: row.key,
        entry: { spawnedCwd: params.projectId ? "/registered-project" : params.cwd },
      };
    }
    if (method === "sessions.list") {
      return { sessions: [row] };
    }
    if (method === "sessions.resolve") {
      return { ok: true, key: "agent:main:chosen" };
    }
    return { ok: true };
  });
  const agent = createAcpGatewayAgent(
    connection,
    createAcpGateway(request as GatewayClient["request"]),
    { sessionStore },
  );
  return { row, agent, sessionStore, request, updates: connection.sessionUpdate };
}

it("creates the native row before snapshots and binds the returned canonical session key", async () => {
  const f = fixture();
  const result = await f.agent.newSession({
    ...createNewSessionRequest("/fixture"),
    _meta: { projectId: "project", sessionTitle: "  Client supplied title  " },
  });
  expect(f.request.mock.calls[0]).toEqual([
    "sessions.create",
    {
      key: expect.stringMatching(/^acp-bridge:/),
      projectId: "project",
      displayName: "Client supplied title",
      sessionType: "acp",
    },
  ]);
  expect(f.sessionStore.getSession(result.sessionId)?.sessionKey).toBe(f.row.key);
  expect(f.sessionStore.getSession(result.sessionId)?.cwd).toBe("/registered-project");
  expect(f.row).toMatchObject({ projectId: "project", displayName: "Client supplied title" });
  expect(f.request.mock.calls.find(([method]) => method === "sessions.list")?.[1]).toMatchObject({
    search: f.row.key,
  });
  expect(f.updates).toHaveBeenCalled();
});
it("routes explicit selection through existing resolution before applying metadata", async () => {
  const f = fixture();
  await f.agent.newSession({
    ...createNewSessionRequest("/fixture"),
    _meta: { sessionLabel: "existing", sessionTitle: "Title" },
  });
  expect(f.request.mock.calls[0]).toEqual(["sessions.resolve", { label: "existing" }]);
  expect(f.request).toHaveBeenCalledWith("sessions.create", {
    key: "agent:main:chosen",
    cwd: "/fixture",
    displayName: "Title",
    sessionType: "acp",
  });
});
it("validates metadata before resolution, creation, ledger updates or session success", async () => {
  const f = fixture();
  await expect(
    f.agent.newSession({
      ...createNewSessionRequest(),
      _meta: { projectId: 7, sessionLabel: "existing" },
    }),
  ).rejects.toMatchObject({ code: -32602 });
  expect(f.request).not.toHaveBeenCalled();
  expect(f.updates).not.toHaveBeenCalled();
});
it("preserves native permission failure and emits no successful session updates", async () => {
  const f = fixture(true);
  await expect(
    f.agent.newSession({
      ...createNewSessionRequest("/fixture"),
      _meta: { sessionTitle: "Title" },
    }),
  ).rejects.toThrow("missing operator.write");
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.updates).not.toHaveBeenCalled();
});
it("durably creates the default Acp type and ignores unrelated metadata fields", async () => {
  const f = fixture();
  const result = await f.agent.newSession({
    ...createNewSessionRequest(),
    _meta: { unrelated: "value" },
  });
  expect(f.request).toHaveBeenCalledWith("sessions.create", {
    key: expect.stringMatching(/^acp-bridge:/),
    cwd: expect.any(String),
    sessionType: "acp",
  });
  expect(f.sessionStore.getSession(result.sessionId)?.sessionKey).toBe(f.row.key);
});

it.each([{ hidden: true, client: 7 }, { client: "" }, { client: "desktop" }])(
  "binds source session type through the real ACP newSession caller: %j",
  async (meta) => {
    const f = fixture();
    await f.agent.newSession({ ...createNewSessionRequest("/fixture"), _meta: meta });
    expect(f.request.mock.calls[0]?.[1]).toMatchObject({
      sessionType: "hidden" in meta && meta.hidden === true ? "hidden" : "user",
    });
  },
);
