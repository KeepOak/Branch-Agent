import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTrunkMcpTools, type TrunkGateway } from "./trunk-tools.js";

const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
});

const accounts = {
  providers: [
    {
      provider: "openai-codex",
      profiles: [{ type: "oauth", displayName: "ChatGPT 1", status: "ok" }],
    },
    {
      provider: "anthropic",
      profiles: [{ type: "token", displayName: "Claude 1", status: "static" }],
    },
  ],
};
const identity = {
  credentialKind: "managed-oauth",
  credentialState: "available",
  refreshState: "available",
};

async function check(models: unknown = accounts, github: unknown = identity, failed?: string) {
  const request = vi.fn(async (method: string) => {
    if (method === failed) throw new Error("private credential diagnostic");
    if (method === "models.authStatus") return models;
    if (method === "agents.list") return { defaultId: "main" };
    if (method === "tools.github.status") return { selected: { identity: github } };
    throw new Error("unexpected gateway method");
  });
  const gw: TrunkGateway = {
    request: request as TrunkGateway["request"],
    onGatewayEvent: () => () => {},
  };
  const server = new McpServer({ name: "branch", version: "test" });
  registerTrunkMcpTools(server, gw, { outsideAgent: () => undefined });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "signin-test", version: "1" });
  clients.push(client);
  await Promise.all([server.connect(a), client.connect(b)]);
  const result = (await client.callTool({ name: "signin_check", arguments: {} })) as CallToolResult;
  return { result, request };
}

describe("signin_check", () => {
  it("returns overall ok when all sign-ins are ok, with only read-only calls", async () => {
    const { result, request } = await check();
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      overall: "ok",
      github: { state: "ok" },
      models: [
        { account_label: "ChatGPT 1", state: "ok" },
        { account_label: "Claude 1", state: "ok" },
      ],
    });
    expect(result.content).toEqual([{ type: "text", text: "sign-ins ok" }]);
    expect(Number.isFinite(Date.parse(String(result.structuredContent?.checked_at)))).toBe(true);
    expect(request.mock.calls).toEqual([
      ["models.authStatus", {}],
      ["agents.list", {}],
      ["tools.github.status", { agentId: "main", selectedScope: "system" }],
    ]);
  });

  it("names only the expired Claude account label in the attention summary", async () => {
    const { result } = await check({
      providers: [
        {
          provider: "anthropic",
          profiles: [
            {
              type: "oauth",
              displayName: "Claude 2",
              status: "expired",
              profileId: "private-profile",
              email: "private-identity",
            },
          ],
        },
      ],
    });
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      models: [{ provider: "anthropic", account_label: "Claude 2", state: "expired" }],
    });
    expect(result.content).toEqual([
      { type: "text", text: "sign-ins need attention: Claude 2 (expired)" },
    ]);
    expect(JSON.stringify(result)).not.toContain("private-");
  });

  it("reports a disconnected managed GitHub sign-in", async () => {
    const { result } = await check(accounts, {
      ...identity,
      credentialState: "configured_unavailable",
      refreshState: "unavailable",
    });
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      github: { state: "disconnected" },
    });
    expect(result.content).toEqual([
      { type: "text", text: "sign-ins need attention: GitHub (disconnected)" },
    ]);
  });

  it.each(["models.authStatus", "tools.github.status", "agents.list"])(
    "returns state error without throwing or retrying when %s throws",
    async (method) => {
      const { result, request } = await check(accounts, identity, method);
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.overall).toBe("attention");
      if (method === "models.authStatus")
        expect(result.structuredContent).toMatchObject({
          models: [{ state: "error" }],
          github: { state: "ok" },
        });
      else
        expect(result.structuredContent).toMatchObject({
          github: { state: "error" },
          models: [{ state: "ok" }, { state: "ok" }],
        });
      expect(request.mock.calls.filter(([name]) => name === method)).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("private credential diagnostic");
    },
  );

  it("never returns email markers, user ids, or the token fixture", async () => {
    const email = ["fixture", "example.invalid"].join(String.fromCharCode(64));
    const token = "fixture-secret-token";
    const { result } = await check(
      {
        providers: [
          {
            provider: "openai-codex",
            profiles: [
              {
                type: "oauth",
                displayName: email,
                email,
                profileId: "private-user-id",
                status: "ok",
                token,
              },
            ],
          },
        ],
      },
      { ...identity, token, account: { login: "private-user-id", email }, gitAuthor: { email } },
    );
    const output = JSON.stringify(result);
    expect(output).not.toContain(String.fromCharCode(64));
    expect(output).not.toContain(token);
    expect(output).not.toContain("private-user-id");
    expect(result.structuredContent).toMatchObject({ models: [{ account_label: "ChatGPT 1" }] });
  });

  it("reports retrying while GitHub refresh is already in progress", async () => {
    const { result } = await check(accounts, { ...identity, refreshState: "refreshing" });
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      github: { state: "retrying" },
    });
  });

  it("does not treat native GitHub sign-in as the managed connection", async () => {
    const { result } = await check(accounts, null);
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      github: { state: "disconnected" },
    });
  });

  it("reports unavailable model preparation as error rather than healthy", async () => {
    const { result } = await check({
      providers: [],
      unavailable: { code: "PREPARED_MODEL_AUTH_UNAVAILABLE" },
    });
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      models: [{ state: "error" }],
    });
  });

  it("reports a missing provider sign-in", async () => {
    const { result } = await check({
      providers: [{ provider: "anthropic", status: "missing", profiles: [] }],
    });
    expect(result.structuredContent).toMatchObject({
      overall: "attention",
      models: [{ account_label: "Claude 1", state: "missing" }],
    });
  });
});
