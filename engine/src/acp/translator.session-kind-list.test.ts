import { expect, it, vi } from "vitest";
import type { GatewayClient } from "../gateway/client.js";
import {
  createAcpConnection,
  createAcpGateway,
  createAcpGatewayAgent,
} from "./translator.test-helpers.js";

vi.mock("./commands.js", () => ({ getAvailableCommands: () => [] }));

function listFixture() {
  const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    const types = params.sessionTypes as string[];
    const sessions = ["user", "scheduled", "acp", "hidden"]
      .filter((type) => types.includes(type))
      .map((type) => ({
        key: `agent:main:${type}`,
        sessionId: type,
        sessionType: type,
        kind: "direct",
        updatedAt: 1,
      }));
    return { sessions, hasMore: false };
  });
  const agent = createAcpGatewayAgent(
    createAcpConnection(),
    createAcpGateway(request as GatewayClient["request"]),
  );
  return { request, agent };
}

it("the actual ACP session/list caller selects source-visible types and excludes Hidden", async () => {
  const f = listFixture();
  const response = await f.agent.listSessions({});
  expect(f.request.mock.calls[0]?.[1].sessionTypes).toEqual(["user", "scheduled", "acp"]);
  expect(response.sessions.map((row) => row.sessionId)).toEqual([
    "agent:main:user",
    "agent:main:scheduled",
    "agent:main:acp",
  ]);
  const first = await f.agent.listSessions({ _meta: { pageSize: 1 } });
  expect(
    (await f.agent.listSessions({ cursor: first.nextCursor, _meta: { pageSize: 1 } })).sessions,
  ).toHaveLength(1);
});
it("the actual caller forwards a type filter, binds pagination and rejects Hidden before RPC", async () => {
  const f = listFixture();
  const first = await f.agent.listSessions({ _meta: { types: ["acp", "user"], pageSize: 1 } });
  expect(first.sessions).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  await expect(
    f.agent.listSessions({ cursor: first.nextCursor, _meta: { types: ["user"], pageSize: 1 } }),
  ).rejects.toThrow("does not match the type filter");
  const second = await f.agent.listSessions({
    cursor: first.nextCursor,
    _meta: { types: ["user", "acp"], pageSize: 1 },
  });
  expect(second.sessions).toHaveLength(1);
  f.request.mockClear();
  await expect(f.agent.listSessions({ _meta: { types: ["hidden"] } })).rejects.toMatchObject({
    code: -32602,
  });
  expect(f.request).not.toHaveBeenCalled();
});
