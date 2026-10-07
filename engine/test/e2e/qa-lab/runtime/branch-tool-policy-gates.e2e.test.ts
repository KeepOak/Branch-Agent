import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { createBranchCodingTools } from "../../../../src/agents/agent-tools.js";
import { createAgentToolsSandboxContext } from "../../../../src/agents/test-helpers/agent-tools-sandbox-context.js";
import { createHostSandboxFsBridge } from "../../../../src/agents/test-helpers/host-sandbox-fs-bridge.js";
import type { BranchConfig } from "../../../../src/config/types.branch.js";

type BranchCodingToolsOptions = NonNullable<Parameters<typeof createBranchCodingTools>[0]>;

function toolNames(
  config: BranchConfig,
  options: Pick<BranchCodingToolsOptions, "sandbox"> = {},
) {
  return new Set(
    createBranchCodingTools({
      config,
      sessionKey: "agent:policy:main",
      agentId: "policy",
      workspaceDir: path.join(os.tmpdir(), "branch-tool-policy-workspace"),
      agentDir: path.join(os.tmpdir(), "branch-tool-policy-agent"),
      modelProvider: "openai",
      modelId: "gpt-5.4",
      ...options,
    }).map((tool) => tool.name),
  );
}

function expectIncluded(names: Set<string>, included: string[], excluded: string[]): void {
  for (const name of included) {
    expect(names, `expected ${name} to pass the policy layer`).toContain(name);
  }
  for (const name of excluded) {
    expect(names, `expected ${name} to be rejected by the policy layer`).not.toContain(name);
  }
}

test("Branch Agent applies every configured tool policy as a restrictive intersection", () => {
  const profileConfig: BranchConfig = {
    tools: { profile: "coding" },
  };
  expectIncluded(toolNames(profileConfig), ["read", "write", "edit", "exec"], ["message"]);

  const globalConfig: BranchConfig = {
    tools: {
      profile: "coding",
      allow: ["group:fs", "exec", "process"],
      deny: ["apply_patch"],
    },
  };
  expectIncluded(
    toolNames(globalConfig),
    ["read", "write", "edit", "exec", "process"],
    ["apply_patch", "message"],
  );

  const providerConfig: BranchConfig = {
    tools: {
      ...globalConfig.tools,
      byProvider: {
        openai: {
          profile: "coding",
          allow: ["read", "write", "edit", "exec", "process"],
          deny: ["edit"],
        },
      },
    },
  };
  expectIncluded(
    toolNames(providerConfig),
    ["read", "write", "exec", "process"],
    ["apply_patch", "edit", "message"],
  );

  const agentConfig: BranchConfig = {
    tools: providerConfig.tools,
    agents: {
      entries: {
        policy: {
          tools: {
            allow: ["read", "write", "exec", "process"],
            deny: ["process"],
          },
        },
      },
    },
  };
  expectIncluded(toolNames(agentConfig), ["read", "write", "exec"], ["edit", "process", "message"]);

  const sandboxDir = path.join(os.tmpdir(), "branch-tool-policy-sandbox");
  const sandbox = createAgentToolsSandboxContext({
    workspaceDir: sandboxDir,
    agentWorkspaceDir: path.join(os.tmpdir(), "branch-tool-policy-workspace"),
    workspaceAccess: "rw",
    fsBridge: createHostSandboxFsBridge(sandboxDir),
    tools: {
      allow: ["read", "write", "exec"],
      deny: ["write", "exec"],
    },
  });
  expectIncluded(toolNames(agentConfig, { sandbox }), ["read"], ["write", "edit", "exec"]);
});
