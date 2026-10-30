import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDoctorMemoryAgent } from "../../gateway/server-methods/doctor-memory-target.js";
import type { GatewayRequestContext } from "../../gateway/server-methods/types.js";
import { prepareSessionMutationFacts } from "../../gateway/session-sharing-preparation.js";
import { listGatewayAgentsBasic } from "../../gateway/agent-list.js";
import { resetConfigRuntimeState } from "../../config/config.js";
import { loadCombinedSessionStoreForGatewayCore } from "../../config/sessions/combined-store-gateway.js";
import {
  SessionStoreAgentIdRequiredError,
  resolveSessionStorePathCore,
} from "../../config/sessions/paths.js";
import { BranchSchema } from "../../config/zod-schema.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { closeBranchAgentDatabasesForTest } from "../../state/branch-agent-db.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { createBranchTestState, type BranchTestState } from "../../test-utils/branch-test-state.js";
import { listAgentIds } from "../agent-scope.js";
import { createAgent } from "../agent-create.js";
import { persistImplicitOnboardingTrunkAtStartup } from "../implicit-main-agent.js";

function contactless(state: BranchTestState): BranchConfig {
  return {
    gateway: { mode: "local", bind: "loopback" },
    agents: { ownership: "explicit", defaults: { workspace: state.workspaceDir } },
  };
}

function storeAgentIdError(error: unknown): boolean {
  if (error instanceof SessionStoreAgentIdRequiredError) {
    return true;
  }
  return error instanceof Error && storeAgentIdError(error.cause);
}

async function readSaved(state: BranchTestState): Promise<BranchConfig> {
  return JSON.parse(await fs.readFile(state.configPath, "utf8")) as BranchConfig;
}

async function withState(label: string, run: (state: BranchTestState) => Promise<void>) {
  const state = await createBranchTestState({ layout: "state-only", scenario: "empty", label });
  try {
    await run(state);
  } finally {
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    await state.cleanup();
  }
}

async function assertMainSessionReady(cfg: BranchConfig) {
  expect(() => resolveSessionStorePathCore(cfg.session?.store, { agentId: "main" })).not.toThrow();
  expect(() =>
    loadCombinedSessionStoreForGatewayCore(cfg, { includeIncognito: false }),
  ).not.toThrow();
  let facts: Awaited<ReturnType<typeof prepareSessionMutationFacts>> | undefined;
  try {
    facts = await prepareSessionMutationFacts({
      cfg,
      sessionKey: "agent:main:main",
      agentId: "main",
      allowMissing: true,
    });
    expect(facts.storageTarget.agentId).toBe("main");
    facts.readCurrent(cfg);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
    expect(storeAgentIdError(error), `${message} cause: ${cause}`).toBe(false);
    expect(message, cause).not.toContain("Session access facts are unavailable");
    throw error;
  } finally {
    facts?.release();
  }
}

describe("onboarding trunk persistence", () => {
  it("keeps the onboarding Trunk when a second Trunk is created and memory resolves", async () => {
    await withState("onboarding-then-juniper", async (state) => {
      const marker = path.join(state.workspaceDir, "sapling-notes.txt");
      await fs.writeFile(marker, "sapling-notes");
      await state.writeConfig(contactless(state));
      resetConfigRuntimeState();
      await persistImplicitOnboardingTrunkAtStartup();
      const onboarded = await readSaved(state);
      expect(BranchSchema.safeParse(onboarded).success).toBe(true);
      expect(onboarded.agents?.defaultId).toBe("main");
      expect(onboarded.agents?.entries?.main?.workspace).toBe(state.workspaceDir);
      expect(onboarded.agents?.entries?.main?.name).toBeUndefined();
      expect(await fs.readFile(marker, "utf8")).toBe("sapling-notes");
      const firstRoster = await listGatewayAgentsBasic(onboarded);
      expect(firstRoster.agents).toEqual([
        expect.objectContaining({ id: "main", kind: "agent" }),
      ]);
      await assertMainSessionReady(onboarded);

      resetConfigRuntimeState();
      const created = await createAgent({ name: "Juniper" });
      expect(created.status).toBe("created");
      const saved = await readSaved(state);
      expect(listAgentIds(saved).toSorted()).toEqual(["juniper", "main"]);
      expect(saved.agents?.entries?.main?.name).toBeUndefined();
      expect(saved.agents?.entries?.main?.workspace).toBe(state.workspaceDir);
      expect(saved.agents?.entries?.juniper?.name).toBe("Juniper");
      expect(path.resolve(saved.agents?.entries?.juniper?.workspace ?? "")).not.toBe(
        path.resolve(state.workspaceDir),
      );
      expect(await fs.readFile(marker, "utf8")).toBe("sapling-notes");
      const roster = await listGatewayAgentsBasic(saved);
      expect(roster.agents.map((agent) => agent.id).toSorted()).toEqual(["juniper", "main"]);
      let refusal: string | undefined;
      const memory = resolveDoctorMemoryAgent(
        { getRuntimeConfig: () => saved } as GatewayRequestContext,
        { agentId: "main" },
        (_ok, _payload, error) => {
          refusal =
            error && typeof error === "object" && "message" in error ? error.message : "refused";
        },
      );
      expect(refusal).toBeUndefined();
      expect(memory?.agentId).toBe("main");
      await assertMainSessionReady(saved);
    });
  });

  it("restores a displaced onboarding Trunk without deleting the Trunk that replaced it", async () => {
    await withState("restore-displaced-main", async (state) => {
      const juniperWorkspace = path.join(state.workspaceDir, "juniper");
      await fs.mkdir(juniperWorkspace, { recursive: true });
      await fs.writeFile(path.join(juniperWorkspace, "notes.txt"), "juniper-notes");
      await fs.writeFile(path.join(state.workspaceDir, "sapling-notes.txt"), "sapling-notes");
      await fs.mkdir(state.sessionsDir("main"), { recursive: true });
      await fs.writeFile(path.join(state.sessionsDir("main"), "sessions.json"), "{}\n");
      await state.writeConfig({
        gateway: { mode: "local", bind: "loopback" },
        agents: {
          ownership: "explicit",
          defaultId: "juniper",
          defaults: { workspace: state.workspaceDir },
          entries: { juniper: { name: "Juniper", workspace: juniperWorkspace } },
        },
      });
      resetConfigRuntimeState();
      await persistImplicitOnboardingTrunkAtStartup();
      const saved = await readSaved(state);
      expect(saved.agents?.defaultId).toBe("juniper");
      expect(saved.agents?.entries?.juniper?.name).toBe("Juniper");
      expect(path.resolve(saved.agents?.entries?.juniper?.workspace ?? "")).toBe(juniperWorkspace);
      expect(path.resolve(saved.agents?.entries?.main?.workspace ?? "")).toBe(
        path.resolve(state.workspaceDir),
      );
      expect(listAgentIds(saved).toSorted()).toEqual(["juniper", "main"]);
      expect(await fs.readFile(path.join(juniperWorkspace, "notes.txt"), "utf8")).toBe(
        "juniper-notes",
      );
      expect(await fs.readFile(path.join(state.workspaceDir, "sapling-notes.txt"), "utf8")).toBe(
        "sapling-notes",
      );
      let refusal: string | undefined;
      const memory = resolveDoctorMemoryAgent(
        { getRuntimeConfig: () => saved } as GatewayRequestContext,
        { agentId: "main" },
        (_ok, _payload, error) => {
          refusal =
            error && typeof error === "object" && "message" in error ? error.message : "refused";
        },
      );
      expect(refusal).toBeUndefined();
      expect(memory?.agentId).toBe("main");
    });
  });

  it("keeps main's files when another Trunk had inherited that workspace", async () => {
    await withState("retarget-inherited-workspace", async (state) => {
      await fs.writeFile(path.join(state.workspaceDir, "sapling-notes.txt"), "sapling-notes");
      await fs.mkdir(state.sessionsDir("main"), { recursive: true });
      await state.writeConfig({
        gateway: { mode: "local", bind: "loopback" },
        agents: {
          defaultId: "juniper",
          defaults: { workspace: state.workspaceDir },
          entries: { juniper: { name: "Juniper" } },
        },
      });
      resetConfigRuntimeState();
      await persistImplicitOnboardingTrunkAtStartup();
      const saved = await readSaved(state);
      expect(saved.agents?.entries?.juniper?.name).toBe("Juniper");
      expect(path.resolve(saved.agents?.entries?.juniper?.workspace ?? "")).toBe(
        path.join(state.workspaceDir, "juniper"),
      );
      expect(path.resolve(saved.agents?.entries?.main?.workspace ?? "")).toBe(
        path.resolve(state.workspaceDir),
      );
      expect(await fs.readFile(path.join(state.workspaceDir, "sapling-notes.txt"), "utf8")).toBe(
        "sapling-notes",
      );
      await expect(fs.stat(path.join(state.workspaceDir, "juniper"))).rejects.toThrow();
    });
  });

  it("still drops the compatibility roster only when first-agent bootstrap asks to", async () => {
    await withState("bootstrap-first-agent", async (state) => {
      await fs.writeFile(path.join(state.workspaceDir, "sapling-notes.txt"), "sapling-notes");
      await state.writeConfig(contactless(state));
      resetConfigRuntimeState();
      const created = await createAgent({
        name: "Robby",
        workspace: state.path("robby"),
        bootstrapFirstAgent: true,
      });
      expect(created.status).toBe("created");
      const saved = await readSaved(state);
      expect(saved.agents?.entries?.robby?.name).toBe("Robby");
      expect(saved.agents?.entries?.main).toBeUndefined();
      expect(await fs.readFile(path.join(state.workspaceDir, "sapling-notes.txt"), "utf8")).toBe(
        "sapling-notes",
      );
    });
  });
});
