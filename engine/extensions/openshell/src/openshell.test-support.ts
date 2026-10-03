import type { CreateSandboxBackendParams } from "branch/plugin-sdk/sandbox";
import {
  createSandboxBrowserConfig,
  createSandboxPruneConfig,
  createSandboxSshConfig,
} from "branch/plugin-sdk/test-fixtures";

export function createOpenShellBackendSandboxConfig(): CreateSandboxBackendParams["cfg"] {
  return {
    mode: "all",
    backend: "openshell",
    scope: "session",
    workspaceAccess: "rw",
    workspaceRoot: "/tmp/branch-sandboxes",
    dockerTmpfsSource: "configured",
    docker: {
      image: "branch-sandbox:bookworm-slim",
      containerPrefix: "branch-sbx-",
      workdir: "/workspace",
      readOnlyRoot: false,
      tmpfs: [],
      network: "none",
      capDrop: [],
      binds: [],
      env: {},
    },
    ssh: createSandboxSshConfig("/tmp/branch-sandboxes"),
    browser: createSandboxBrowserConfig(),
    tools: { allow: ["*"], deny: [] },
    prune: createSandboxPruneConfig(),
  };
}

export function createOpenShellRuntimeEntryFixture(runtimeId: string, configLabel = "branch") {
  return {
    containerName: runtimeId,
    backendId: "openshell",
    runtimeLabel: runtimeId,
    sessionKey: "agent:main",
    createdAtMs: 1,
    lastUsedAtMs: 1,
    image: configLabel,
    configLabelKind: "Source",
  } as const;
}
