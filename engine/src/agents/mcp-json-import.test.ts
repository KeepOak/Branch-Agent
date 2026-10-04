// Conversion cases ported from continuedev/continue@5522c6f44ca0ac3528b37244818fbfa39b5af470
// packages/config-yaml/src/schemas/mcp/convertJson.test.ts (JSON -> config direction);
// folder loading follows core/context/mcp/json/loadJsonMcpConfigs.ts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMergedBundleMcpConfig } from "./bundle-mcp-config.js";
import {
  convertJsonMcpConfigToBranchServer,
  loadJsonMcpConfigs,
  mcpServersJsonSchema,
  type HttpMcpJsonConfig,
  type SseMcpJsonConfig,
  type StdioMcpJsonConfig,
} from "./mcp-json-import.js";

describe("convertJsonMcpConfigToBranchServer", () => {
  describe("STDIO configurations", () => {
    it("converts basic stdio config", () => {
      const jsonConfig: StdioMcpJsonConfig = { command: "node", args: ["server.js"] };
      const result = convertJsonMcpConfigToBranchServer("test-server", jsonConfig);
      expect(result.server).toEqual({ command: "node", args: ["server.js"] });
      expect(result.warnings).toHaveLength(0);
    });

    it("converts stdio config with all fields", () => {
      const jsonConfig: StdioMcpJsonConfig = {
        type: "stdio",
        command: "python",
        args: ["-m", "server"],
        env: { API_KEY: "test-key", DEBUG: "true" },
      };
      const result = convertJsonMcpConfigToBranchServer("python-server", jsonConfig);
      expect(result.server).toEqual({
        command: "python",
        args: ["-m", "server"],
        env: { API_KEY: "test-key", DEBUG: "true" },
      });
      expect(result.warnings).toHaveLength(0);
    });

    it("warns about unsupported envFile", () => {
      const jsonConfig: StdioMcpJsonConfig = {
        command: "node",
        args: ["server.js"],
        envFile: ".env",
      };
      const result = convertJsonMcpConfigToBranchServer("env-server", jsonConfig);
      expect(result.server).toEqual({ command: "node", args: ["server.js"] });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("envFile is not supported");
    });

    it("converts stdio config from parsed JSON string", () => {
      const parsed = mcpServersJsonSchema.parse(
        JSON.parse(
          JSON.stringify({ command: "deno", args: ["run", "server.ts"], env: { PORT: "3000" } }),
        ),
      );
      expect(convertJsonMcpConfigToBranchServer("deno-server", parsed).server).toEqual({
        command: "deno",
        args: ["run", "server.ts"],
        env: { PORT: "3000" },
      });
    });

    it("resolves ${VAR} env references", () => {
      const result = convertJsonMcpConfigToBranchServer(
        "env-ref",
        { command: "node", env: { TOKEN: "${MY_TOKEN}", KEEP: "${UNSET_VAR}" } },
        { MY_TOKEN: "abc" },
      );
      expect(result.server.env).toEqual({ TOKEN: "abc", KEEP: "${UNSET_VAR}" });
    });
  });

  describe("SSE/HTTP configurations", () => {
    it("converts basic SSE config", () => {
      const jsonConfig: SseMcpJsonConfig = { url: "https://api.example.com/sse" };
      const result = convertJsonMcpConfigToBranchServer("sse-server", jsonConfig);
      expect(result.server).toEqual({ url: "https://api.example.com/sse" });
      expect(result.warnings).toHaveLength(0);
    });

    it("converts SSE config with type and headers", () => {
      const jsonConfig: SseMcpJsonConfig = {
        type: "sse",
        url: "https://api.example.com/sse",
        headers: { Authorization: "Bearer token", "X-Custom-Header": "value" },
      };
      expect(convertJsonMcpConfigToBranchServer("sse-auth", jsonConfig).server).toEqual({
        transport: "sse",
        url: "https://api.example.com/sse",
        headers: { Authorization: "Bearer token", "X-Custom-Header": "value" },
      });
    });

    it("converts HTTP config", () => {
      const jsonConfig: HttpMcpJsonConfig = {
        type: "http",
        url: "https://api.example.com/http",
        headers: { "Content-Type": "application/json" },
      };
      expect(convertJsonMcpConfigToBranchServer("http-server", jsonConfig).server).toEqual({
        transport: "streamable-http",
        url: "https://api.example.com/http",
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  it("throws error for invalid config", () => {
    expect(() =>
      convertJsonMcpConfigToBranchServer("invalid", { invalid: "config" } as never),
    ).toThrowError("Invalid MCP server configuration");
  });
});

describe("loadJsonMcpConfigs", () => {
  let workspaceDir: string;
  let stateDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-json-ws-"));
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-json-state-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  function write(dir: string, name: string, value: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), value);
  }

  it("reads Claude Desktop, Claude Code and single-server files from workspace and global folders", () => {
    const wsDir = path.join(workspaceDir, ".branch", "mcpServers");
    write(
      wsDir,
      "desktop.json",
      JSON.stringify({ mcpServers: { files: { command: "fs-server" } } }),
    );
    write(
      wsDir,
      "claude-code.json",
      JSON.stringify({
        mcpServers: { top: { type: "http", url: "https://top.example/mcp" } },
        projects: { "/repo": { mcpServers: { nested: { command: "nested-server" } } } },
      }),
    );
    write(
      path.join(wsDir, "more"),
      "single.json",
      '// comment allowed\n{ "command": "single-server" }',
    );
    write(
      path.join(stateDir, "mcpServers"),
      "global.json",
      JSON.stringify({
        mcpServers: { files: { command: "global-fs" }, globalOnly: { url: "https://g.example" } },
      }),
    );

    const loaded = loadJsonMcpConfigs({
      workspaceDir,
      includeGlobal: true,
      env: { BRANCH_STATE_DIR: stateDir, HOME: stateDir },
    });
    expect(loaded.mcpServers).toEqual({
      top: { transport: "streamable-http", url: "https://top.example/mcp" },
      nested: { command: "nested-server" },
      files: { command: "fs-server" },
      single: { command: "single-server" },
      globalOnly: { url: "https://g.example" },
    });
    expect(loaded.diagnostics).toEqual([]);
  });

  it("reports unsupported and unparsable files without dropping valid ones", () => {
    const wsDir = path.join(workspaceDir, ".branch", "mcpServers");
    write(wsDir, "bad.json", "{ nope");
    write(wsDir, "other.json", JSON.stringify({ something: true }));
    write(wsDir, "ok.json", JSON.stringify({ command: "ok" }));
    const loaded = loadJsonMcpConfigs({ workspaceDir, includeGlobal: false });
    expect(loaded.mcpServers).toEqual({ ok: { command: "ok" } });
    expect(loaded.diagnostics.map((d) => d.message).join("\n")).toMatch(
      /Error parsing MCP JSON file/,
    );
    expect(loaded.diagnostics.map((d) => d.message).join("\n")).toMatch(
      /doesn't match a supported/,
    );
  });

  it("feeds the merged runtime config below owner config", () => {
    const wsDir = path.join(workspaceDir, ".branch", "mcpServers");
    write(
      wsDir,
      "servers.json",
      JSON.stringify({ mcpServers: { dropIn: { command: "a" }, owned: { command: "b" } } }),
    );
    const merged = loadMergedBundleMcpConfig({
      workspaceDir,
      cfg: { mcp: { servers: { owned: { command: "owner" } } } },
    });
    expect(merged.config.mcpServers.dropIn).toEqual({ command: "a" });
    expect(merged.config.mcpServers.owned).toEqual({ command: "owner" });
  });
});
