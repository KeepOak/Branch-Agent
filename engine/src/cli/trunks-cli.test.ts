import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTrunksCli, templateSourceFromArg } from "./trunks-cli.js";

const callGatewayFromCli = vi.hoisted(() => vi.fn());
vi.mock("./gateway-rpc.js", () => ({ callGatewayFromCli }));

afterEach(() => {
  vi.restoreAllMocks();
  callGatewayFromCli.mockReset();
});

function createProgram(response: unknown) {
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  callGatewayFromCli.mockResolvedValue(response);
  const program = new Command().exitOverride();
  registerTrunksCli(program);
  return { output, program };
}

const cli = (...args: string[]) => ["node", "branch", "trunks", ...args];

describe("templateSourceFromArg", () => {
  it("treats a bare name as a bundled template id", () => {
    expect(templateSourceFromArg("researcher", "/work")).toEqual({ templateId: "researcher" });
  });

  it("resolves a path or a .json file against the working directory", () => {
    expect(templateSourceFromArg("templates/scout.trunk-template.json", "/work")).toEqual({
      templatePath: path.resolve("/work", "templates/scout.trunk-template.json"),
    });
    expect(templateSourceFromArg("scout.json", "/work")).toEqual({
      templatePath: path.resolve("/work", "scout.json"),
    });
  });
});

describe("branch trunks export", () => {
  it("asks the gateway for the template with the read scope and writes it to the file", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "trunks-export-"));
    const target = path.join(dir, "scout.trunk-template.json");
    const { output, program } = createProgram({
      file: "branch.trunk-template.json",
      template: { format: "branch.trunk-template", version: 1, name: "Scout" },
      warnings: ["Model family was not set."],
    });
    await program.parseAsync(cli("export", "scout", "--out", target));

    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "trunks.template.export",
      expect.objectContaining({ out: target }),
      { agentId: "scout" },
      { scopes: ["operator.read"] },
    );
    expect(JSON.parse(readFileSync(target, "utf8"))).toMatchObject({ name: "Scout" });
    expect(output).toHaveBeenCalledWith(`Wrote ${target}\n`);
    expect(output).toHaveBeenCalledWith("warning: Model family was not set.\n");
  });

  it("refuses to overwrite an existing file without --force, before calling the gateway", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "trunks-export-"));
    const target = path.join(dir, "existing.trunk-template.json");
    writeFileSync(target, "{}");
    const { program } = createProgram({ template: {} });
    await expect(program.parseAsync(cli("export", "scout", "--out", target))).rejects.toThrow(/already exists/);
    expect(callGatewayFromCli).not.toHaveBeenCalled();
    expect(readFileSync(target, "utf8")).toBe("{}");
  });

  it("does not overwrite a file that appears while the gateway call runs", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "trunks-export-"));
    const target = path.join(dir, "raced.trunk-template.json");
    const { program } = createProgram({ template: { name: "Scout" } });
    callGatewayFromCli.mockImplementationOnce(async () => {
      writeFileSync(target, "someone else's file");
      return { template: { name: "Scout" } };
    });
    await expect(program.parseAsync(cli("export", "scout", "--out", target))).rejects.toThrow(/already exists/);
    expect(readFileSync(target, "utf8")).toBe("someone else's file");
  });

  it("overwrites with --force", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "trunks-export-"));
    const target = path.join(dir, "existing.trunk-template.json");
    writeFileSync(target, "{}");
    const { program } = createProgram({ template: { name: "Scout" } });
    await program.parseAsync(cli("export", "scout", "--out", target, "--force"));
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ name: "Scout" });
  });
});

describe("branch trunks create", () => {
  it("creates from a bundled template id with the admin scope and prints the new Trunk", async () => {
    const { output, program } = createProgram({ agentId: "newagent", workspace: "/ws/newagent", warnings: [] });
    await program.parseAsync(cli("create", "--from-template", "researcher"));
    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "trunks.template.create",
      expect.any(Object),
      { templateId: "researcher" },
      { scopes: ["operator.admin"] },
    );
    expect(output).toHaveBeenCalledWith("Created Trunk newagent in /ws/newagent\n");
  });

  it("sends an absolute template path and an optional name", async () => {
    const { program } = createProgram({ agentId: "newagent" });
    await program.parseAsync(cli("create", "--from-template", "/abs/scout.trunk-template.json", "--name", "Scout"));
    expect(callGatewayFromCli).toHaveBeenCalledWith(
      "trunks.template.create",
      expect.any(Object),
      { templatePath: path.resolve("/abs/scout.trunk-template.json"), name: "Scout" },
      { scopes: ["operator.admin"] },
    );
  });

  it("prints the raw answer as JSON with --json", async () => {
    const answer = { agentId: "newagent", workspace: "/ws", warnings: ["x"] };
    const { output, program } = createProgram(answer);
    await program.parseAsync(cli("create", "--from-template", "builder", "--json"));
    expect(output).toHaveBeenCalledWith(`${JSON.stringify(answer, null, 2)}\n`);
  });
});
