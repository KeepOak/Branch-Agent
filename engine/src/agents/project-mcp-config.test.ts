// injectEnv/injectVariables cases ported from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16
// src/utils/__tests__/config.spec.ts; project-merge cases follow McpHub.spec.ts project-config behaviour.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSessionMcpConfig } from "./agent-bundle-mcp-runtime-config.js";
import { loadMergedBundleMcpConfig } from "./bundle-mcp-config.js";
import { injectEnv, injectVariables, loadProjectMcpServers } from "./project-mcp-config.js";

describe("injectEnv", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should replace env variables in a string", () => {
    process.env.TEST_VAR = "testValue";
    expect(injectEnv("Hello ${env:TEST_VAR}")).toBe("Hello testValue");
  });

  it("should replace env variables in an object", () => {
    process.env.API_KEY = "12345";
    process.env.ENDPOINT = "https://example.com";
    const nested = {
      string: "Keep this ${env:API_KEY}",
      number: 123,
      boolean: true,
      stringArr: ["${env:API_KEY}", "${env:ENDPOINT}"],
      numberArr: [123, 456],
      booleanArr: [true, false],
    };
    const expectedNested = {
      string: "Keep this 12345",
      number: 123,
      boolean: true,
      stringArr: ["12345", "https://example.com"],
      numberArr: [123, 456],
      booleanArr: [true, false],
    };
    expect(
      injectEnv({ key: "${env:API_KEY}", url: "${env:ENDPOINT}", nested, deeply: { nested } }),
    ).toEqual({
      key: "12345",
      url: "https://example.com",
      nested: expectedNested,
      deeply: { nested: expectedNested },
    });
  });

  it("should use notFoundValue for missing env variables", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.EXISTING_VAR = "exists";
    expect(injectEnv("Value: ${env:EXISTING_VAR}, Missing: ${env:MISSING_VAR}", "NOT_FOUND")).toBe(
      "Value: exists, Missing: NOT_FOUND",
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      `[injectVariables] variable "MISSING_VAR" referenced but not found in "env"`,
    );
    consoleWarnSpy.mockRestore();
  });

  it("should use default empty string for missing env variables if notFoundValue is not provided", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(injectEnv("Missing: ${env:ANOTHER_MISSING}")).toBe("Missing: ");
    consoleWarnSpy.mockRestore();
  });

  it("should handle strings and objects without env variables", () => {
    expect(injectEnv("Just a regular string")).toBe("Just a regular string");
    expect(injectEnv({ key: "value", number: 123 })).toEqual({ key: "value", number: 123 });
  });

  it("should not mutate the original object", () => {
    process.env.MUTATE_TEST = "mutated";
    const originalObject = { value: "${env:MUTATE_TEST}" };
    injectEnv(originalObject);
    expect(originalObject).toEqual({ value: "${env:MUTATE_TEST}" });
  });

  it("should handle empty input", () => {
    expect(injectEnv("")).toBe("");
    expect(injectEnv({})).toEqual({});
  });
});

describe("injectVariables", () => {
  it("should replace singular variable", () => {
    expect(injectVariables("Hello ${v}", { v: "Hola" })).toEqual("Hello Hola");
  });

  it("should handle undefined singular variable input", () => {
    expect(injectVariables("Hello ${v}", { v: undefined })).toEqual("Hello ${v}");
  });

  it("should handle empty string singular variable input", () => {
    expect(injectVariables("Hello ${v}", { v: "" })).toEqual("Hello ");
  });

  it("should normalize Windows paths with backslashes to use forward slashes in JSON objects", () => {
    expect(
      injectVariables(
        { command: "mcp-server", args: ["${workspaceFolder}"] },
        { workspaceFolder: "C:\\Users\\project" },
      ),
    ).toEqual({ command: "mcp-server", args: ["C:/Users/project"] });
  });

  it("should handle complex Windows paths in nested objects", () => {
    expect(
      injectVariables(
        {
          servers: {
            git: {
              command: "node",
              args: ["${workspaceFolder}\\scripts\\mcp.js", "${workspaceFolder}\\data"],
            },
          },
        },
        { workspaceFolder: "C:\\Program Files\\My Project" },
      ),
    ).toEqual({
      servers: {
        git: {
          command: "node",
          args: [
            "C:/Program Files/My Project\\scripts\\mcp.js",
            "C:/Program Files/My Project\\data",
          ],
        },
      },
    });
  });

  it("should normalize backslashes in plain string replacements", () => {
    expect(injectVariables("Path: ${path}", { path: "C:\\Users\\test" })).toEqual(
      "Path: C:/Users/test",
    );
  });

  it("should handle paths with mixed slashes", () => {
    expect(
      injectVariables({ path: "${testPath}" }, { testPath: "C:\\Users/test/mixed\\path" }),
    ).toEqual({ path: "C:/Users/test/mixed/path" });
  });

  it("should not affect non-path strings", () => {
    expect(
      injectVariables(
        { message: "This is a string with a backslash \\ and a value: ${myValue}" },
        { myValue: "test" },
      ),
    ).toEqual({ message: "This is a string with a backslash \\ and a value: test" });
  });

  it("should handle various non-path variables correctly", () => {
    expect(
      injectVariables(
        { apiKey: "${key}", url: "${endpoint}", description: "${desc}" },
        {
          key: "sk-1234567890abcdef",
          endpoint: "https://api.example.com",
          desc: "This is a description with special chars: @#$%^&*()",
        },
      ),
    ).toEqual({
      apiKey: "sk-1234567890abcdef",
      url: "https://api.example.com",
      description: "This is a description with special chars: @#$%^&*()",
    });
  });
});

describe("project MCP servers from .branch/mcp.json", () => {
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "project-mcp-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  function writeProjectConfig(value: unknown) {
    fs.mkdirSync(path.join(workspaceDir, ".branch"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDir, ".branch", "mcp.json"),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }

  it("has no project servers without the file", () => {
    expect(loadProjectMcpServers(workspaceDir)).toEqual({ mcpServers: {}, diagnostics: [] });
  });

  it("loads project servers, injects variables and maps Roo-style keys", () => {
    process.env.PROJECT_MCP_TOKEN = "secret-token";
    writeProjectConfig({
      mcpServers: {
        files: {
          command: "node",
          args: ["${workspaceFolder}/server.mjs"],
          env: { TOKEN: "${env:PROJECT_MCP_TOKEN}" },
          timeout: 90,
          disabledTools: ["delete_file"],
          alwaysAllow: ["read_file"],
        },
        remote: { type: "streamable-http", url: "https://mcp.example.com/mcp" },
        off: { command: "node", disabled: true },
      },
    });
    const { mcpServers } = loadProjectMcpServers(workspaceDir);
    expect(mcpServers).toEqual({
      files: {
        command: "node",
        args: [`${workspaceDir.replace(/\\/g, "/")}/server.mjs`],
        env: { TOKEN: "secret-token" },
        requestTimeoutMs: 90_000,
        toolFilter: { exclude: ["delete_file"] },
      },
      remote: { transport: "streamable-http", url: "https://mcp.example.com/mcp" },
    });
    delete process.env.PROJECT_MCP_TOKEN;
  });

  it("reports invalid project files without failing the load", () => {
    writeProjectConfig("{ not json");
    const loaded = loadProjectMcpServers(workspaceDir);
    expect(loaded.mcpServers).toEqual({});
    expect(loaded.diagnostics[0]?.message).toContain("invalid JSON");
  });

  it("lets project servers override global servers with the same name and drops them when the file goes", () => {
    const cfg = {
      mcp: {
        servers: {
          shared: { command: "global-server" },
          globalOnly: { command: "global-only" },
        },
      },
    };
    writeProjectConfig({
      mcpServers: { shared: { command: "project-server" }, projectOnly: { command: "p" } },
    });
    const withProject = loadMergedBundleMcpConfig({ workspaceDir, cfg });
    expect(withProject.config.mcpServers.shared).toEqual({ command: "project-server" });
    expect(withProject.config.mcpServers.projectOnly).toEqual({ command: "p" });
    expect(withProject.config.mcpServers.globalOnly).toEqual({ command: "global-only" });
    const before = loadSessionMcpConfig({ workspaceDir, cfg, logDiagnostics: false });

    fs.rmSync(path.join(workspaceDir, ".branch", "mcp.json"));
    const withoutProject = loadMergedBundleMcpConfig({ workspaceDir, cfg });
    expect(withoutProject.config.mcpServers.shared).toEqual({ command: "global-server" });
    expect(withoutProject.config.mcpServers.projectOnly).toBeUndefined();
    // The session runtime fingerprint changes, so the next turn reconnects without a restart.
    expect(loadSessionMcpConfig({ workspaceDir, cfg, logDiagnostics: false }).fingerprint).not.toBe(
      before.fingerprint,
    );
  });

  it("honours a session override that turns a project server off", () => {
    writeProjectConfig({ mcpServers: { projectOnly: { command: "p" } } });
    const merged = loadMergedBundleMcpConfig({
      workspaceDir,
      toolOverrides: { mcpServers: { projectOnly: false } },
    });
    expect(merged.config.mcpServers.projectOnly).toBeUndefined();
  });
});
