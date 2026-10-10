import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import type { GatewayRequestHandlerOptions } from "./shared-types.js";
import { trunkTemplatesHandlers } from "./trunk-templates.js";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("./agents.js", () => ({ agentsHandlers: { "agents.create": createMock } }));

const BUNDLED_SKILLS = path.resolve(import.meta.dirname, "../../../skills");

function workspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "trunk-template-handler-"));
}

function call(
  method: "trunks.template.create" | "trunks.template.export",
  params: Record<string, unknown>,
  cfg: BranchConfig,
) {
  const respond = vi.fn();
  const options = {
    params,
    respond,
    context: { getRuntimeConfig: () => cfg },
  } as unknown as GatewayRequestHandlerOptions;
  const done = trunkTemplatesHandlers[method](options);
  return { respond, done: Promise.resolve(done) };
}

const newTrunkConfig = (dir: string) =>
  ({ agents: { entries: { newagent: { name: "New", workspace: dir } } } }) as unknown as BranchConfig;

beforeAll(() => {
  process.env.BRANCH_BUNDLED_SKILLS_DIR = BUNDLED_SKILLS;
});

beforeEach(() => {
  createMock.mockReset();
});

describe("trunks.template.create", () => {
  it("creates a Trunk from a bundled template, writes its persona, and answers once", async () => {
    const dir = workspace();
    createMock.mockImplementation(async (options: { respond: (ok: boolean, payload?: unknown) => void }) => {
      options.respond(true, { ok: true, agentId: "newagent" });
    });
    const { respond, done } = call("trunks.template.create", { templateId: "researcher" }, newTrunkConfig(dir));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(respond.mock.calls[0]?.[1]).toMatchObject({ ok: true, agentId: "newagent" });
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toContain("# Researcher");
  });

  it("answers once with an error for an unknown template id, without creating a Trunk", async () => {
    const { respond, done } = call("trunks.template.create", { templateId: "no-such-template" }, newTrunkConfig(workspace()));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects a relative template path with one error answer", async () => {
    const { respond, done } = call("trunks.template.create", { templatePath: "relative.json" }, newTrunkConfig(workspace()));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("answers with the create error once and writes no persona", async () => {
    const dir = workspace();
    createMock.mockImplementation(async (options: { respond: (ok: boolean, payload?: unknown, error?: unknown) => void }) => {
      options.respond(false, undefined, { code: "INVALID_REQUEST", message: "name taken" });
    });
    const { respond, done } = call("trunks.template.create", { templateId: "builder" }, newTrunkConfig(dir));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("answers once with an error when agents.create throws", async () => {
    createMock.mockRejectedValue(new Error("config write failed"));
    const { respond, done } = call("trunks.template.create", { templateId: "builder" }, newTrunkConfig(workspace()));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("answers once with an error when agents.create never answers", async () => {
    createMock.mockResolvedValue(undefined);
    const { respond, done } = call("trunks.template.create", { templateId: "builder" }, newTrunkConfig(workspace()));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("reports skills and a model family from a template as warnings, not failures", async () => {
    const dir = workspace();
    const file = path.join(workspace(), "custom.json");
    writeFileSync(
      file,
      JSON.stringify({
        format: "branch.trunk-template",
        version: 1,
        name: "Custom",
        persona: { agentsMd: "# Custom\n" },
        skills: ["seedbank:@branch-agent/summarize-pdf"],
        toolsets: {},
        model: { family: "gpt-5.5" },
        permissions: ["This template sets no tool restrictions. Tool switches are set per Trunk after creating it."],
      }),
    );
    createMock.mockImplementation(async (options: { respond: (ok: boolean, payload?: unknown) => void }) => {
      options.respond(true, { ok: true, agentId: "newagent" });
    });
    const { respond, done } = call("trunks.template.create", { templatePath: file }, newTrunkConfig(dir));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    const payload = respond.mock.calls[0]?.[1] as { warnings: string[] };
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    expect(payload.warnings).toEqual([
      expect.stringContaining("Model family"),
      expect.stringContaining("was not attached"),
    ]);
  });
});

describe("trunks.template.export", () => {
  it("answers once with an error for a Trunk that does not exist", async () => {
    const { respond, done } = call("trunks.template.export", { agentId: "ghost" }, { agents: { entries: {} } } as unknown as BranchConfig);
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
  });

  it("refuses to export persona text that looks like a secret", async () => {
    const dir = workspace();
    writeFileSync(path.join(dir, "AGENTS.md"), "Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz\n");
    const { respond, done } = call("trunks.template.export", { agentId: "newagent" }, newTrunkConfig(dir));
    await done;
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls[0])).not.toContain("ghp_");
  });
});
