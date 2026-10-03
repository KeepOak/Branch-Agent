import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { markGroveMcpServerIndependentlyOwned } from "../state/grove-mcp-adoption.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import {
  deleteGroveMcpServerRef,
  installGroveMcpServers,
  planGroveMcpServerRemoval,
  readGroveMcpServerRefs,
} from "./mcp.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveSourceIdentity } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchStateDatabaseForTest());

function configuredServers() {
  return {
    docs: {
      command: "uvx",
      args: ["docs-mcp"],
      env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
    },
    linear: {
      url: "https://mcp.linear.app/mcp",
      transport: "streamable-http",
      auth: "oauth",
    },
  };
}

async function fixture(agentId = "worker", root?: string) {
  const packageRoot = root ?? tempDirs.make("branch-grove-mcp-");
  const parsed = parseGroveManifest({
    schemaVersion: 1,
    agent: { id: agentId },
    mcpServers: configuredServers(),
  });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }
  const source: GroveSourceIdentity = {
    kind: "package",
    name: `@acme/${agentId}`,
    version: "1.0.0",
    packageRoot,
    manifestPath: join(packageRoot, "branch.grove.json"),
    integrityKind: "artifact",
    integrity: "sha256:manifest",
    byteLength: 100,
  };
  const plan = await buildGroveAddPlan({
    manifest: parsed.manifest,
    source,
    context: { workspace: join(packageRoot, "workspace") },
  });
  return { root: packageRoot, plan, env: { BRANCH_STATE_DIR: join(packageRoot, "state") } };
}

function listedMcpServers(mcpServers: Record<string, Record<string, unknown>> = {}) {
  return { ok: true as const, path: "config", config: {}, mcpServers, runtimeConfig: {} };
}

describe("installGroveMcpServers", () => {
  it("uses create-only config writes and stores digest-only ownership", async () => {
    const current = await fixture();
    const setMcpServer = vi
      .fn()
      .mockResolvedValue({ ok: true, path: "config", config: {}, mcpServers: {} });

    const refs = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
      nowMs: 42,
    });

    expect(setMcpServer).toHaveBeenNthCalledWith(1, {
      name: "docs",
      server: {
        command: "uvx",
        args: ["docs-mcp"],
        env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
      },
      createOnly: true,
      recordIndependentOwner: false,
    });
    expect(setMcpServer).toHaveBeenNthCalledWith(2, {
      name: "linear",
      server: {
        url: "https://mcp.linear.app/mcp",
        transport: "streamable-http",
        auth: "oauth",
      },
      createOnly: true,
      recordIndependentOwner: false,
    });
    expect(refs).toMatchObject([
      {
        schemaVersion: "branch.groveMcpServerRef.v1",
        agentId: "worker",
        name: "docs",
        configDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        relationship: "managed",
        origin: "grove-introduced",
        independentOwner: false,
        status: "complete",
      },
      {
        schemaVersion: "branch.groveMcpServerRef.v1",
        agentId: "worker",
        name: "linear",
        configDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        status: "complete",
      },
    ]);
    expect(JSON.stringify(refs)).not.toContain("DOCS_TOKEN");
  });

  it("rejects a conflicting existing server without claiming ownership", async () => {
    const current = await fixture();
    await expect(
      installGroveMcpServers(current.plan, {
        env: current.env,
        listMcpServers: vi
          .fn()
          .mockResolvedValue(listedMcpServers({ docs: { command: "different" } })),
      }),
    ).rejects.toMatchObject({
      code: "mcp_config_conflict",
      mcpServers: [],
    });
  });

  it("reuses an exact pre-existing server as a referenced resource", async () => {
    const current = await fixture();
    const setMcpServer = vi.fn();
    const refs = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers(configuredServers())),
    });

    expect(setMcpServer).not.toHaveBeenCalled();
    expect(refs).toMatchObject([
      {
        name: "docs",
        relationship: "referenced",
        origin: "pre-existing",
        independentOwner: true,
        status: "complete",
      },
      {
        name: "linear",
        relationship: "referenced",
        origin: "pre-existing",
        independentOwner: true,
        status: "complete",
      },
    ]);
    expect(planGroveMcpServerRemoval(refs[0]!, { env: current.env }).action).toBe("release");
  });

  it("allows another Grove to share an exact Grove-created server", async () => {
    const first = await fixture("worker");
    const firstRefs = await installGroveMcpServers(first.plan, {
      env: first.env,
      setMcpServer: vi.fn().mockResolvedValue(listedMcpServers()),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });
    const second = await fixture("analyst", first.root);
    const setMcpServer = vi.fn();
    const refs = await installGroveMcpServers(second.plan, {
      env: second.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers(configuredServers())),
    });

    expect(setMcpServer).not.toHaveBeenCalled();
    expect(refs).toMatchObject([
      {
        agentId: "analyst",
        name: "docs",
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
      },
      {
        agentId: "analyst",
        name: "linear",
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
      },
    ]);
    const firstDocs = firstRefs[0]!;
    expect(planGroveMcpServerRemoval(firstDocs, { env: first.env }).action).toBe("release");
    const secondDocs = refs[0]!;
    deleteGroveMcpServerRef("worker", "docs", { env: first.env });
    expect(
      planGroveMcpServerRemoval(secondDocs, {
        env: first.env,
        referencedCleanup: { mode: "remove-if-unused" },
      }).action,
    ).toBe("remove");
    deleteGroveMcpServerRef("analyst", "docs", { env: first.env });
    expect(planGroveMcpServerRemoval(firstDocs, { env: first.env }).action).toBe("remove");
  });

  it("serializes concurrent claims for the same MCP server", async () => {
    const first = await fixture("worker");
    const second = await fixture("analyst", first.root);
    const configured: Record<string, Record<string, unknown>> = {};
    let releaseFirstWrite!: () => void;
    const firstWriteReleased = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let notifyFirstWrite!: () => void;
    const firstWriteStarted = new Promise<void>((resolve) => {
      notifyFirstWrite = resolve;
    });
    const setMcpServer = vi.fn(
      async ({ name, server }: { name: string; server: Record<string, unknown> }) => {
        if (setMcpServer.mock.calls.length === 1) {
          notifyFirstWrite();
          await firstWriteReleased;
        }
        configured[name] = server;
        return listedMcpServers(configured);
      },
    );
    const listMcpServers = vi.fn(async () => listedMcpServers(configured));

    const firstInstall = installGroveMcpServers(first.plan, {
      env: first.env,
      setMcpServer,
      listMcpServers,
    });
    await firstWriteStarted;
    const secondInstall = installGroveMcpServers(second.plan, {
      env: second.env,
      setMcpServer,
      listMcpServers,
    });
    releaseFirstWrite();

    const [firstRefs, secondRefs] = await Promise.all([firstInstall, secondInstall]);
    expect(setMcpServer).toHaveBeenCalledTimes(2);
    expect(firstRefs).toMatchObject([
      { name: "docs", relationship: "managed", status: "complete" },
      { name: "linear", relationship: "managed", status: "complete" },
    ]);
    expect(secondRefs).toMatchObject([
      {
        name: "docs",
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
        status: "complete",
      },
      {
        name: "linear",
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
        status: "complete",
      },
    ]);
  });

  it("requires explicit conflict consent to remove a pre-existing reference", async () => {
    const current = await fixture();
    const [ref] = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer: vi.fn(),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers(configuredServers())),
    });
    const selector = `mcp:${ref!.name}`;

    expect(
      planGroveMcpServerRemoval(ref!, {
        env: current.env,
        referencedCleanup: { mode: "remove-selected", selected: [selector] },
      }),
    ).toMatchObject({ action: "release", blocked: true });
    expect(
      planGroveMcpServerRemoval(ref!, {
        env: current.env,
        referencedCleanup: {
          mode: "remove-selected",
          selected: [selector],
          allowConflicts: true,
        },
      }),
    ).toMatchObject({ action: "remove", blocked: false });
  });

  it("retains a managed server after an ordinary MCP owner adopts it", async () => {
    const current = await fixture();
    await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer: vi.fn().mockResolvedValue(listedMcpServers()),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });

    expect(markGroveMcpServerIndependentlyOwned("docs", { env: current.env, nowMs: 50 })).toBe(1);
    expect(markGroveMcpServerIndependentlyOwned("docs", { env: current.env, nowMs: 60 })).toBe(0);
    const refs = readGroveMcpServerRefs("worker", { env: current.env });
    expect(refs).toMatchObject([
      { name: "docs", independentOwner: true, updatedAtMs: 50 },
      { name: "linear", independentOwner: false },
    ]);
    const status = planGroveMcpServerRemoval(refs[0]!, { env: current.env });
    expect(status).toMatchObject({ action: "release", blocked: false });
  });

  it("reconciles an ambiguous write from source config on retry", async () => {
    const current = await fixture();
    const setMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error("write result unknown"))
      .mockResolvedValue({ ok: true, path: "config", config: {}, mcpServers: {} });
    await expect(
      installGroveMcpServers(current.plan, {
        env: current.env,
        setMcpServer,
        listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
      }),
    ).rejects.toMatchObject({
      code: "mcp_install_uncertain",
      mcpServers: [{ name: "docs", status: "pending" }],
    });

    const refs = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue({
        ok: true,
        path: "config",
        config: {},
        mcpServers: {
          docs: {
            command: "uvx",
            args: ["docs-mcp"],
            env: { DOCS_TOKEN: "${DOCS_TOKEN}" },
          },
        },
      }),
    });

    expect(setMcpServer).toHaveBeenCalledTimes(2);
    expect(refs[0]).toMatchObject({ name: "docs", status: "complete" });
    expect(refs[1]).toMatchObject({ name: "linear", status: "complete" });
  });

  it("retries an ambiguous write that did not reach source config", async () => {
    const current = await fixture();
    const setMcpServer = vi
      .fn()
      .mockRejectedValueOnce(new Error("write result unknown"))
      .mockResolvedValue(listedMcpServers());
    await expect(
      installGroveMcpServers(current.plan, {
        env: current.env,
        setMcpServer,
        listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
      }),
    ).rejects.toMatchObject({ code: "mcp_install_uncertain" });

    const refs = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });

    expect(setMcpServer).toHaveBeenCalledTimes(3);
    expect(refs).toEqual([
      expect.objectContaining({ name: "docs", status: "complete" }),
      expect.objectContaining({ name: "linear", status: "complete" }),
    ]);
  });

  it("repairs complete ownership when the configured servers disappeared", async () => {
    const current = await fixture();
    await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer: vi.fn().mockResolvedValue(listedMcpServers()),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });
    const setMcpServer = vi.fn().mockResolvedValue(listedMcpServers());

    const refs = await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer,
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });

    expect(setMcpServer).toHaveBeenCalledTimes(2);
    expect(refs).toEqual([
      expect.objectContaining({ name: "docs", status: "complete" }),
      expect.objectContaining({ name: "linear", status: "complete" }),
    ]);
  });

  it("does not recreate a removed pre-existing server on retry", async () => {
    const current = await fixture();
    const configured = configuredServers();
    await installGroveMcpServers(current.plan, {
      env: current.env,
      setMcpServer: vi.fn(),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers(configured)),
    });
    const setMcpServer = vi.fn();

    await expect(
      installGroveMcpServers(current.plan, {
        env: current.env,
        setMcpServer,
        listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
      }),
    ).rejects.toMatchObject({ code: "mcp_reconcile_conflict" });
    expect(setMcpServer).not.toHaveBeenCalled();
  });

  it("does not recreate a removed server after another Grove shares it", async () => {
    const first = await fixture("worker");
    await installGroveMcpServers(first.plan, {
      env: first.env,
      setMcpServer: vi.fn().mockResolvedValue(listedMcpServers()),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
    });
    const second = await fixture("analyst", first.root);
    const configured = configuredServers();
    await installGroveMcpServers(second.plan, {
      env: second.env,
      setMcpServer: vi.fn(),
      listMcpServers: vi.fn().mockResolvedValue(listedMcpServers(configured)),
    });
    const setMcpServer = vi.fn();

    await expect(
      installGroveMcpServers(first.plan, {
        env: first.env,
        setMcpServer,
        listMcpServers: vi.fn().mockResolvedValue(listedMcpServers()),
      }),
    ).rejects.toMatchObject({ code: "mcp_reconcile_conflict" });
    expect(setMcpServer).not.toHaveBeenCalled();
  });
});
