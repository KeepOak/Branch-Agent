import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  claimAgentRunDelegatedAuthority,
  releaseAgentRunDelegatedAuthority,
} from "../infra/agent-run-registry.js";
import { createTestAdmittedRunContext } from "./admitted-run-context.test-support.js";
import {
  createCronCreatorAuthorityCapability,
  runWithCronCreatorAuthorityCapability,
} from "./cron-creator-authority-context.js";
import type { AnyAgentTool } from "./tools/common.js";

const mocks = vi.hoisted(() => {
  const onToolExecute = vi.fn(async () => ({ content: [], details: {} }));
  const stubTool = (name: string) =>
    ({
      name,
      label: name,
      displaySummary: name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: onToolExecute,
    }) satisfies AnyAgentTool;

  return {
    createBranchToolsOptions: vi.fn(),
    stubTool,
    onToolExecute,
  };
});

vi.mock("./branch-tools.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./branch-tools.js")>();
  return {
    createBranchTools: (options: unknown) => {
      mocks.createBranchToolsOptions(options);
      return [AUTOMATIONS_TOOL_NAME, "gateway"].map(mocks.stubTool);
    },
    filterToolsByClientCaps: actual.filterToolsByClientCaps,
  };
});

import "./test-helpers/fast-bash-tools.js";
import "./test-helpers/fast-coding-tools.js";
import { createBranchCodingTools } from "./agent-tools.js";
import { createAgentToolsSandboxContext } from "./test-helpers/agent-tools-sandbox-context.js";
import { AUTOMATIONS_TOOL_NAME } from "./tools/automations-tool-name.js";
import {
  getGatewayToolCallerIdentity,
  withGatewayToolCallerIdentity,
} from "./tools/gateway-caller-context.js";

function firstBranchToolsOptions(): { cronSelfRemoveOnlyJobId?: string } | undefined {
  return mocks.createBranchToolsOptions.mock.calls[0]?.[0] as
    | { cronSelfRemoveOnlyJobId?: string }
    | undefined;
}

describe("createBranchCodingTools cron scope", () => {
  beforeEach(() => {
    mocks.createBranchToolsOptions.mockClear();
  });

  it("scopes cron-triggered jobs to self-removal", () => {
    const tools = createBranchCodingTools({
      trigger: "cron",
      jobId: "job-current",
    });

    expect(tools.map((tool) => tool.name)).toContain(AUTOMATIONS_TOOL_NAME);
    expect(firstBranchToolsOptions()?.cronSelfRemoveOnlyJobId).toBe("job-current");
  });

  it.each([undefined, "channel-owner"] as const)(
    "admits only the automation tool for management-only authority=%s",
    async (source) => {
      const runId = "remote-management-tools";
      const { operationalRunInstance } = createTestAdmittedRunContext(runId);
      const authority = claimAgentRunDelegatedAuthority(operationalRunInstance);
      onTestFinished(() => {
        releaseAgentRunDelegatedAuthority(authority);
      });
      const capability = createCronCreatorAuthorityCapability(
        runId,
        { kind: "unknown" },
        source ? { source, isCurrent: () => true } : undefined,
      )!;
      const tools = await runWithCronCreatorAuthorityCapability(capability, () =>
        withGatewayToolCallerIdentity(
          {
            agentId: "main",
            sessionKey: "agent:main:control-ui",
            operationalRunInstance,
            approvalAuthority: authority,
          },
          () =>
            createBranchCodingTools({
              runId,
              senderIsOwner: false,
              wrapBeforeToolCallHook: false,
              toolConstructionPlan: {
                includeBaseCodingTools: false,
                includeShellTools: false,
                includeChannelTools: false,
                includeBranchTools: true,
                includePluginTools: false,
              },
            }),
        ),
      );
      const names = tools.map((tool) => tool.name);
      expect(names.includes(AUTOMATIONS_TOOL_NAME)).toBe(Boolean(source));
      expect(names).not.toContain("gateway");
    },
  );
});

const createLazyExecToolMock = vi.hoisted(() => vi.fn());

vi.mock("./lazy-exec-tool.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lazy-exec-tool.js")>();
  return {
    ...actual,
    createLazyExecTool: (defaults: unknown) => {
      createLazyExecToolMock(defaults);
      return {
        name: "exec",
        description: "exec stub",
        parameters: { type: "object", properties: {} },
        execute: vi.fn(),
      };
    },
  };
});

describe("createBranchCodingTools exec notification routing", () => {
  it("binds native tool approval requests to the constructed permission generation", async () => {
    const generation = new AbortController();
    let approvalScope: AbortSignal | undefined;
    mocks.onToolExecute.mockImplementationOnce(async () => {
      approvalScope = AbortSignal.any([...(getGatewayToolCallerIdentity()?.approvalSignals ?? [])]);
      return { content: [], details: {} };
    });
    const tools = createBranchCodingTools({
      agentId: "main",
      sessionKey: "agent:main:scope",
      abortSignal: generation.signal,
      wrapBeforeToolCallHook: false,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeBranchTools: true,
        includePluginTools: false,
      },
    });
    const tool = tools.find((candidate) => candidate.name === AUTOMATIONS_TOOL_NAME);
    if (!tool) {
      throw new Error("Expected automation tool");
    }
    await tool.execute("call", {});
    generation.abort();
    expect(approvalScope?.aborted).toBe(true);
  });

  it("keeps live process ownership separate from the policy session", () => {
    const liveSessionKey = "agent:main:channel:group:example:thread:25";
    const policySessionKey = "agent:main:runtime-policy";

    createBranchCodingTools({
      sessionKey: policySessionKey,
      runSessionKey: liveSessionKey,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: true,
        includeChannelTools: false,
        includeBranchTools: false,
        includePluginTools: false,
      },
    });

    expect(createLazyExecToolMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKey: liveSessionKey,
        sessionKey: policySessionKey,
        runSessionKey: liveSessionKey,
      }),
    );
  });
});

describe("createBranchCodingTools sandbox filesystem ownership", () => {
  const sandbox = createAgentToolsSandboxContext({ workspaceDir: "/managed/workspace" });

  it("keeps host-owned tools available when no sandbox filesystem family is requested", () => {
    mocks.createBranchToolsOptions.mockClear();

    const tools = createBranchCodingTools({
      sandbox,
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeBranchTools: true,
        includePluginTools: true,
      },
    });

    expect(tools.map((tool) => tool.name)).toContain(AUTOMATIONS_TOOL_NAME);
    expect(mocks.createBranchToolsOptions).toHaveBeenCalledOnce();
  });

  it.each([
    { includeBaseCodingTools: true, includeShellTools: false },
    { includeBaseCodingTools: false, includeShellTools: true },
  ])("rejects sandbox filesystem families without their bridge: %o", (families) => {
    expect(() =>
      createBranchCodingTools({
        sandbox,
        toolConstructionPlan: {
          ...families,
          includeChannelTools: false,
          includeBranchTools: false,
          includePluginTools: false,
        },
      }),
    ).toThrow("Sandbox filesystem bridge is unavailable.");
  });
});
