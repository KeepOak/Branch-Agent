import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Value } from "typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ReportFindingsOutputSchema } from "../coding/report-findings.js";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { getAgentToolActionDescriptor } from "./agent-tool-metadata.js";
import { createBranchCodingTools } from "./agent-tools.js";
import type { BranchCodingToolsOptions } from "./agent-tools.options.js";
import { createCoreCodingTools } from "./core-coding-tools.js";
import { resolveCoreToolFactoryFamily } from "./core-tool-factory-descriptors.js";
import { isKnownCoreToolId, resolveCoreToolProfilePolicy } from "./tool-catalog.js";

const parentDir = path.join(os.tmpdir(), "Codex-session-files");
const tempDirs = createSuiteTempRootTracker({ prefix: "report-findings-native-", parentDir });
let root: string;
beforeAll(async () => {
  await fs.mkdir(parentDir, { recursive: true });
  root = await tempDirs.setup();
});
afterAll(() => tempDirs.cleanup());
const finding = {
  id: "R1-1",
  severity: "Critical",
  file: "src/report.ts",
  line: 7,
  summary: "A report loses its identity",
  failureScenario: "The next turn drops an unresolved finding.",
};

function assembled(options: Partial<BranchCodingToolsOptions> = {}) {
  return createBranchCodingTools({
    workspaceDir: root,
    cwd: root,
    config: { tools: { profile: "coding" } },
    toolConstructionPlan: {
      includeBaseCodingTools: true,
      includeShellTools: false,
      includeChannelTools: false,
      includeBranchTools: false,
      includePluginTools: false,
    },
    ...options,
  });
}

function report(options: Partial<BranchCodingToolsOptions> = {}) {
  const tool = assembled(options).find((candidate) => candidate.name === "report_findings");
  expect(tool).toBeDefined();
  return tool!;
}

describe("native report_findings coding surface", () => {
  it.each([false, undefined])(
    "registers reporting without file or process authority with senderIsOwner=%s",
    async (senderIsOwner) => {
      expect(isKnownCoreToolId("report_findings")).toBe(true);
      expect(resolveCoreToolProfilePolicy("coding")?.allow).toContain("report_findings");
      expect(resolveCoreToolProfilePolicy("messaging")?.allow).not.toContain("report_findings");
      expect(resolveCoreToolFactoryFamily("report_findings")).toBe("base-coding");
      const tool = report({ senderIsOwner });
      expect(getAgentToolActionDescriptor(tool)).toEqual({ family: "tool", operation: "branch" });
      expect(tool.catalogMode).toBe("direct-only");
      const result = await tool.execute("native", { findings: [finding] });
      expect(Value.Check(ReportFindingsOutputSchema, result.details)).toBe(true);
      expect(result.details).toMatchObject({ findings: [{ file: "src/report.ts", line: 7 }] });
    },
  );

  it("builds reporting through the actual report-only tool policy", async () => {
    const tools = assembled({
      toolConstructionPlan: undefined,
      config: { tools: { allow: ["report_findings"] } },
    });
    expect(tools.map((tool) => tool.name)).toEqual(["report_findings"]);
    expect((await tools[0]!.execute("only-report", { findings: [finding] })).details).toMatchObject(
      { type: "findings_list", findings: [{ id: "R1-1" }] },
    );
  });

  it("preserves identity across native caller rebuilds using the admitted run session key", async () => {
    const runSessionKey = `agent:main:${randomUUID()}`;
    await report({ sessionKey: `agent:main:${randomUUID()}`, runSessionKey }).execute("first", {
      findings: [finding, { ...finding, id: "R1-2" }],
    });
    await expect(
      report({ sessionKey: `agent:main:${randomUUID()}`, runSessionKey }).execute("drop", {
        findings: [{ ...finding, outcome: "fixed" }],
      }),
    ).rejects.toThrow(/drops 1 finding/);
    const result = await report({ runSessionKey }).execute("complete", {
      findings: [
        { ...finding, outcome: "fixed" },
        { ...finding, id: "R1-2", outcome: "no_change_needed" },
      ],
    });
    expect(result.details).toMatchObject({
      findings: [{ outcome: "fixed" }, { outcome: "no_change_needed" }],
    });
    await expect(
      report({ runSessionKey: `agent:main:${randomUUID()}` }).execute("unrelated", {
        findings: [{ ...finding, outcome: "fixed" }],
      }),
    ).resolves.toBeDefined();
  });

  it("allows reporting with a read-only coding surface without assigning file authority", () => {
    const tools = createCoreCodingTools({
      codingRoot: root,
      containmentRoot: root,
      includeBaseCodingTools: true,
      shellTools: "disabled",
      workspaceOnly: true,
      readOnly: true,
      applyPatchEnabled: false,
      applyPatchWorkspaceOnly: true,
      execDefaults: {},
      processDefaults: {},
    });
    const tool = tools.find((candidate) => candidate.name === "report_findings");
    expect(tool).toBeDefined();
    expect(getAgentToolActionDescriptor(tool!)).toBeUndefined();
    expect(tools.some((candidate) => candidate.name === "write" || candidate.name === "edit")).toBe(
      false,
    );
  });

  it("isolates explicit execution agent owners sharing the global session alias", async () => {
    const suffix = randomUUID();
    const options = (agentId: string): Partial<BranchCodingToolsOptions> => ({
      agentId,
      sessionKey: "global",
      config: { agents: { ownership: "explicit" }, tools: { profile: "coding" } },
    });
    const main = options(`review-main-${suffix}`);
    const work = options(`review-work-${suffix}`);
    await report(main).execute("main-report", { findings: [{ ...finding, id: "main-1" }] });
    await expect(
      report(work).execute("work-first-outcome", {
        findings: [{ ...finding, id: "work-1", outcome: "fixed" }],
      }),
    ).resolves.toBeDefined();
    await report(work).execute("work-report", { findings: [{ ...finding, id: "work-1" }] });
    await expect(
      report(main).execute("main-outcome", {
        findings: [{ ...finding, id: "main-1", outcome: "fixed" }],
      }),
    ).resolves.toBeDefined();
    await expect(
      report(work).execute("work-outcome", {
        findings: [{ ...finding, id: "work-1", outcome: "no_change_needed" }],
      }),
    ).resolves.toBeDefined();
  });

  it("keeps the reporter outside memory flush and disabled base coding scopes", () => {
    const narrow = assembled({
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeBranchTools: false,
        includePluginTools: false,
      },
    });
    expect(narrow.some((tool) => tool.name === "report_findings")).toBe(false);
    const flush = assembled({ trigger: "memory", memoryFlushWritePath: "memory/report-test.md" });
    expect(flush.some((tool) => tool.name === "report_findings")).toBe(false);
  });

  it("honors explicit runtime policy denial", () => {
    expect(
      assembled({ config: { tools: { profile: "coding", deny: ["report_findings"] } } }).some(
        (tool) => tool.name === "report_findings",
      ),
    ).toBe(false);
  });
});
