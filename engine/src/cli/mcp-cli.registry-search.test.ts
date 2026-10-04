import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupMcpCliTestState,
  mockError,
  mockLog,
  resetMcpCliTestState,
  runMcpCommand,
} from "./mcp-cli.test-harness.js";

function registryPage(servers: Array<Record<string, unknown>>) {
  return new Response(
    JSON.stringify({
      servers: servers.map((server) => ({
        server,
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            isLatest: true,
            publishedAt: "2026-09-01T00:00:00Z",
          },
        },
      })),
      metadata: { count: servers.length },
    }),
    { headers: { "content-type": "application/json" } },
  );
}

describe("branch mcp search", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetMcpCliTestState();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    await cleanupMcpCliTestState();
  });

  it("lists matching public Registry servers", async () => {
    fetchMock.mockResolvedValueOnce(
      registryPage([
        {
          name: "io.github.example/weather",
          title: "Weather",
          description: "Forecasts",
          version: "1.2.0",
          remotes: [{ type: "streamable-http", url: "https://weather.example/mcp" }],
        },
        {
          name: "io.github.example/files",
          description: "Local files",
          version: "0.1.0",
          packages: [
            { registryType: "npm", identifier: "@example/files", transport: { type: "stdio" } },
          ],
        },
      ]),
    );
    await runMcpCommand(["mcp", "search", "weather"]);
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.origin).toBe("https://registry.modelcontextprotocol.io");
    expect(requested.pathname).toBe("/v0/servers");
    const output = mockLog.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain(
      "- Weather (io.github.example/weather@1.2.0, remote) https://weather.example/mcp",
    );
    expect(output).not.toContain("files");
  });

  it("prints JSON results", async () => {
    fetchMock.mockResolvedValueOnce(
      registryPage([
        {
          name: "io.github.example/files",
          description: "Local files",
          version: "0.1.0",
          packages: [
            { registryType: "npm", identifier: "@example/files", transport: { type: "stdio" } },
          ],
        },
      ]),
    );
    await runMcpCommand(["mcp", "search", "--json"]);
    const printed = JSON.parse(String(mockLog.mock.calls.at(-1)?.[0]));
    expect(printed).toEqual([
      expect.objectContaining({
        name: "io.github.example/files",
        connectionType: "stdio",
        npmPackage: "@example/files",
      }),
    ]);
  });

  it("reports Registry failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(runMcpCommand(["mcp", "search", "x"])).rejects.toThrow("__exit__:1");
    expect(String(mockError.mock.calls.at(-1)?.[0])).toContain(
      "MCP Registry search failed: MCP registry request failed with HTTP 503",
    );
  });
});
