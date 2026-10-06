import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfigRuntimeState } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { withEnvAsync } from "../test-utils/env.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import { BranchSchema } from "../config/zod-schema.js";
import { listGatewayAgentsBasic } from "./agent-list.js";
import { migrateDevAgentConfig, removeSeededDevAgentAtStartup } from "./dev-agent-startup.js";

const seedWorkspace = path.join("C:", "owner", ".branch-dev", "workspace");
const seed = { workspace: seedWorkspace, identity: { name: "C3-PO", theme: "protocol droid", emoji: "🤖" } };
const ownerConfig: BranchConfig = {
  gateway: { mode: "local", bind: "loopback" },
  agents: {
    defaultId: "oak",
    defaults: { workspace: seedWorkspace, heartbeat: { agentId: "dev" } },
    entries: { dev: seed, oak: { identity: { name: "Oak" } } },
  },
};

describe("P11 dev-profile migration", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await closeBranchStateDatabaseAsync();
    resetConfigRuntimeState();
    await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("keeps a fresh explicit profile contactless while retaining its internal owner", async () => {
    const config: BranchConfig = {
      gateway: { mode: "local", bind: "loopback" },
      agents: { ownership: "explicit", defaults: { workspace: path.join("C:", "fresh", ".branch", "workspace") } },
    };
    expect(BranchSchema.safeParse(config).success).toBe(true);
    const roster = await listGatewayAgentsBasic(config);
    expect(roster).toMatchObject({ defaultId: "main", ownership: "explicit", selectionRequired: true });
    expect(roster.agents.find((agent) => agent.id === "main")?.kind).toBe("system");
  });

  it("removes only the exact C3-PO seed, rehomes workspace and safely retargets heartbeat", () => {
    const migrated = migrateDevAgentConfig(ownerConfig)!;
    expect(migrated.agents?.entries?.dev).toBeUndefined();
    expect(migrated.agents?.entries?.oak).toMatchObject({
      identity: { name: "Oak" },
      workspace: path.join("C:", "owner", ".branch", "workspace", "oak"),
    });
    expect(migrated.agents?.defaults?.workspace).toBe(path.join("C:", "owner", ".branch", "workspace"));
    expect(migrated.agents?.defaults?.heartbeat?.agentId).toBe("oak");
    expect(migrateDevAgentConfig(migrated)).toBeUndefined();
    const noDefault = structuredClone(ownerConfig);
    delete noDefault.agents!.defaultId;
    expect(migrateDevAgentConfig(noDefault)?.agents?.defaults?.heartbeat?.agentId).toBeUndefined();
  });

  it("keeps a sole Trunk on the inherited workspace root", () => {
    const sole = structuredClone(ownerConfig);
    delete sole.agents!.defaultId;
    delete sole.agents!.entries!.dev;
    const migrated = migrateDevAgentConfig(sole)!;
    expect(migrated.agents?.entries?.oak?.workspace).toBe(path.join("C:", "owner", ".branch", "workspace"));
  });

  it("keeps a normalized default dev Trunk instead of removing its entry", () => {
    const selected = structuredClone(ownerConfig);
    selected.agents!.defaultId = "DEV";
    const migrated = migrateDevAgentConfig(selected)!;
    expect(migrated.agents?.entries?.dev).toBeDefined();
    expect(BranchSchema.safeParse(migrated).success).toBe(true);
  });

  it("turns a stock-only dev roster into a valid contactless first run", () => {
    const stockOnly = structuredClone(ownerConfig);
    delete stockOnly.agents!.defaultId;
    delete stockOnly.agents!.entries!.oak;
    const migrated = migrateDevAgentConfig(stockOnly)!;
    expect(migrated.agents?.ownership).toBe("explicit");
    expect(migrated.agents?.entries).toBeUndefined();
    expect(BranchSchema.safeParse(migrated).success).toBe(true);
  });

  it("keeps edited or default dev Trunks while rehoming their workspace", () => {
    const edited = structuredClone(ownerConfig);
    edited.agents!.entries!.dev!.identity!.name = "My Droid";
    expect(migrateDevAgentConfig(edited)?.agents?.entries?.dev).toMatchObject({ identity: { name: "My Droid" } });
    const selected = structuredClone(ownerConfig);
    selected.agents!.defaultId = "dev";
    expect(migrateDevAgentConfig(selected)?.agents?.entries?.dev).toBeDefined();
  });

  it("removes the stock seed after automatic character assignment but keeps custom avatars", () => {
    const assigned = structuredClone(ownerConfig);
    assigned.agents!.characterAssignmentVersion = 1;
    assigned.agents!.entries!.dev!.identity = { name: "C3-PO", theme: "protocol droid", avatar: "branch:ember" };
    expect(migrateDevAgentConfig(assigned)?.agents?.entries?.dev).toBeUndefined();
    assigned.agents!.entries!.dev!.identity!.avatar = "https://example.invalid/my-droid.png";
    expect(migrateDevAgentConfig(assigned)?.agents?.entries?.dev).toBeDefined();
  });

  it("backs up owner-like config before removing the seed and does nothing on second start", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "branch-p11-config-"));
    dirs.push(root);
    const configPath = path.join(root, "branch.json");
    const raw = JSON.stringify(ownerConfig, null, 2) + "\n";
    await fs.writeFile(configPath, raw);
    await withEnvAsync({ BRANCH_CONFIG_PATH: configPath, BRANCH_STATE_DIR: root }, async () => {
      resetConfigRuntimeState();
      await removeSeededDevAgentAtStartup();
      const backups = (await fs.readdir(root)).filter((name) => name.includes(".p11-backup-"));
      expect(backups).toHaveLength(1);
      expect(await fs.readFile(path.join(root, backups[0]!), "utf8")).toBe(raw);
      const migrated = JSON.parse(await fs.readFile(configPath, "utf8")) as BranchConfig;
      expect(migrated.agents?.entries?.dev).toBeUndefined();
      expect(migrated.agents?.defaults?.heartbeat?.agentId).toBe("oak");
      expect(migrateDevAgentConfig(migrated)).toBeUndefined();
      await removeSeededDevAgentAtStartup();
      expect((await fs.readdir(root)).filter((name) => name.includes(".p11-backup-"))).toHaveLength(1);
    });
  });
});
