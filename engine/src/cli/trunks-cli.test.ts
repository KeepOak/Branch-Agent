import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFollowUps, parseAnswerOptions, registerTrunksCli, templateSourceFromArg } from "./trunks-cli.js";

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

  it("passes a template link through as a link", () => {
    expect(templateSourceFromArg(" branch-template:1:abc ", "/work")).toEqual({ link: "branch-template:1:abc" });
  });

  it("keeps an imported catalog id as an id", () => {
    expect(templateSourceFromArg("imported:night-shift", "/work")).toEqual({ templateId: "imported:night-shift" });
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

describe("branch trunks share and import", () => {
  it("prints the template link with export --link and writes no file", async () => {
    const { output, program } = createProgram({ link: "branch-template:1:abc", template: {}, warnings: [] });
    await program.parseAsync(cli("export", "scout", "--link"));
    expect(output).toHaveBeenCalledWith("branch-template:1:abc\n");
  });

  it("says which routines are off and which channels need setting up after a create", () => {
    expect(
      createFollowUps({
        agentId: "night",
        routines: [{ id: "j1", name: "Digest" }],
        connections: [{ id: "telegram", ready: false }, { id: "slack", ready: true }],
      }),
    ).toEqual([
      'Routine "Digest" was added turned off. Turn it on in Automations once you approve it.',
      "This Trunk talks on telegram, which is not set up here. Set it up in Channels.",
    ]);
  });

  it("lists the catalog with the read scope", async () => {
    const { output, program } = createProgram({ templates: [{ id: "imported:night-shift", source: "imported", name: "Night Shift", description: "Overnight", routines: 2 }] });
    await program.parseAsync(cli("templates"));
    expect(callGatewayFromCli).toHaveBeenCalledWith("trunks.template.list", expect.any(Object), {}, { scopes: ["operator.read"] });
    expect(output).toHaveBeenCalledWith("imported:night-shift\tNight Shift (imported · 2 routines) - Overnight\n");
  });
});

describe("first-run starters from the CLI", () => {
  it("passes repeated --answer id=value options and --timezone to the create", async () => {
    const { program } = createProgram({ agentId: "night", firstRun: { timezone: "UTC", started: false }, routines: [{ id: "j1", name: "Morning digest" }] });
    await program.parseAsync(cli("create", "--from-template", "night-shift", "--answer", "topics=AI chips", "--answer", "watch=", "--timezone", "UTC"));
    expect(callGatewayFromCli.mock.calls[0]?.[0]).toBe("trunks.template.create");
    expect(callGatewayFromCli.mock.calls[0]?.[2]).toEqual({
      templateId: "night-shift",
      answers: { topics: "AI chips", watch: "" },
      timezone: "UTC",
    });
  });

  it("refuses an --answer without an equals sign", () => {
    expect(() => parseAnswerOptions(["topics"])).toThrow("id=value");
  });

  it("tells the owner the routines wait for Start instead of Automations", () => {
    const lines = createFollowUps({ agentId: "night", firstRun: { timezone: "Europe/Berlin", started: false }, routines: [{ id: "j1", name: "Morning digest" }] });
    expect(lines).toEqual(["Its routines are paused and run in Europe/Berlin once you start it: branch trunks start night"]);
  });

  it("lists the starter offer with each question's default", async () => {
    const { output, program } = createProgram({
      timezone: "UTC",
      offer: [{ id: "night-shift", name: "Night Shift", pitch: "Digest every morning.", questions: [{ id: "topics", prompt: "Which topics?", default: "Tech" }] }],
    });
    await program.parseAsync(cli("starters", "--agent", "main", "--goal", "news"));
    expect(callGatewayFromCli.mock.calls[0]?.[2]).toEqual({ agentId: "main", goal: "news" });
    const text = output.mock.calls.map((args) => String(args[0])).join("");
    expect(text).toContain("night-shift\tDigest every morning.");
    expect(text).toContain("topics: Which topics? (default: Tech)");
  });

  it("starts a teammate through trunks.template.start and prints its card", async () => {
    const { output, program } = createProgram({ card: { name: "Night Shift", started: true, summary: "Digest." }, warnings: [] });
    await program.parseAsync(cli("start", "night"));
    expect(callGatewayFromCli.mock.calls[0]?.[0]).toBe("trunks.template.start");
    expect(callGatewayFromCli.mock.calls[0]?.[2]).toEqual({ agentId: "night" });
    expect(output.mock.calls.map((args) => String(args[0])).join("")).toContain("Night Shift is started. Digest.");
  });
});
