import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolveCliCommandPathPolicy } from "./command-path-policy.js";
import { GRAFT_DESCRIPTION, registerGraftCli, registerMcpCli } from "./mcp-cli.js";

const optionNames = (command: Command | undefined) =>
  (command?.options ?? []).map((option) => option.long).toSorted();

describe("branch graft", () => {
  it("is the same command as branch mcp serve, with the same options", () => {
    const program = new Command();
    registerMcpCli(program);
    registerGraftCli(program);
    const graft = program.commands.find((c) => c.name() === "graft");
    const serve = program.commands
      .find((c) => c.name() === "mcp")
      ?.commands.find((c) => c.name() === "serve");
    expect(graft?.description()).toBe(GRAFT_DESCRIPTION);
    expect(serve?.description()).toBe(GRAFT_DESCRIPTION);
    expect(optionNames(graft)).toEqual(optionNames(serve));
    expect(optionNames(graft)).toContain("--url");
  });

  it("owns stdout like mcp serve, so nothing but MCP frames is printed", () => {
    expect(resolveCliCommandPathPolicy(["graft"]).ownsProtocolStdout).toBe(true);
    expect(resolveCliCommandPathPolicy(["mcp", "serve"]).ownsProtocolStdout).toBe(true);
  });
});
