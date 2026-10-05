// Branch: the scheduled / "Back up now" backup never carries secrets. Sentinel secrets are seeded into
// the config file, auth profiles, the secret store, device tokens, machine state, a credentials folder
// and .env files; a real Git backup (database dumps plus the files scope) is pushed to a bare repository
// and every byte that reached Git — the working tree and every decompressed object, locally and in the
// remote — is searched. A full-fidelity run of the same data proves the search finds what it looks for.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigRuntimeState } from "../config/config.js";
import { BRANCH_AGENT_SCHEMA_VERSION } from "../state/branch-agent-db-contract.js";
import { BRANCH_AGENT_SCHEMA_SQL } from "../state/branch-agent-schema.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../state/branch-state-db-contract.js";
import { BRANCH_STATE_SCHEMA_SQL } from "../state/branch-state-schema.js";
import { createTempHomeEnv, type TempHomeEnv } from "../test-utils/temp-home.js";
import { prepareBackupDestination } from "./backup-destination.js";
import { backupGitCreateCommand } from "./backup-git.js";
import { createTestRuntime } from "./test-runtime-config-helpers.js";

const SECRETS = {
  configGatewayToken: "SENTINEL-CFG-GATEWAY-TOKEN-7f3a",
  configApiKey: "SENTINEL-CFG-OPENAI-APIKEY-91bc",
  configBotToken: "SENTINEL-CFG-TELEGRAM-BOT-TOKEN-55de",
  authProfile: "SENTINEL-AUTH-PROFILE-OAUTH-REFRESH-0a1b",
  authProfileFile: "SENTINEL-AUTH-PROFILES-JSON-c2d3",
  secretStore: "SENTINEL-SECRET-STORE-VALUE-e4f5",
  deviceToken: "SENTINEL-DEVICE-AUTH-TOKEN-6a7b",
  machineState: "SENTINEL-MACHINE-STATE-AUTHPROFILE-8c9d",
  credentialsDir: "SENTINEL-CREDENTIALS-DIR-OAUTH-1e2f",
  workspaceEnv: "SENTINEL-WORKSPACE-DOTENV-3a4b",
  stateEnv: "SENTINEL-STATE-DOTENV-5c6d",
  pemKey: "SENTINEL-PRIVATE-KEY-PEM-7e8f",
} as const;
/** Secrets that live in database tables: present without redaction, absent with it. */
const DATABASE_SECRETS = [
  SECRETS.authProfile,
  SECRETS.secretStore,
  SECRETS.deviceToken,
  SECRETS.machineState,
];
const THREAD_MARKER = "ordinary-thread-memory-marker-2b7e";
const MEMORY_MARKER = "ordinary-memory-markdown-marker-9d1c";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

/** Every Git object, decompressed, plus the checked-out files: what a reader of the backup can see. */
async function readEverything(repository: string, bare = false): Promise<string> {
  const objects = git(repository, ["cat-file", "--batch-all-objects", "--batch"]);
  if (bare) {
    return objects;
  }
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== ".git") {
        await walk(full);
      } else if (entry.isFile()) {
        files.push(await fs.readFile(full, "utf8"));
      }
    }
  };
  await walk(repository);
  return `${objects}\n${files.join("\n")}`;
}

function findSentinels(haystack: string, sentinels: readonly string[]): string[] {
  return sentinels.filter((secret) =>
    [secret, Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("hex")].some(
      (form) => haystack.includes(form),
    ),
  );
}

function openDatabase(file: string, role: "global" | "agent"): DatabaseSync {
  const version = role === "global" ? BRANCH_STATE_SCHEMA_VERSION : BRANCH_AGENT_SCHEMA_VERSION;
  const db = new DatabaseSync(file);
  db.exec(role === "global" ? BRANCH_STATE_SCHEMA_SQL : BRANCH_AGENT_SCHEMA_SQL);
  db.exec(`PRAGMA user_version=${version}`);
  db.prepare(
    "INSERT INTO schema_meta(meta_key,role,schema_version,agent_id,created_at,updated_at) VALUES('primary',?,?,?,1,1)",
  ).run(role, version, role === "agent" ? "main" : null);
  return db;
}

async function seedDatabases(stateDir: string, agentDir: string): Promise<void> {
  await fs.mkdir(path.join(stateDir, "state"), { recursive: true });
  const global = openDatabase(path.join(stateDir, "state", "branch.sqlite"), "global");
  global
    .prepare(
      "INSERT INTO secret_store_entries(scope_kind,scope_id,name,value,kind,created_at_ms,updated_at_ms) VALUES('team','','OPENAI_API_KEY',?,'secret',1,1)",
    )
    .run(SECRETS.secretStore);
  global
    .prepare(
      "INSERT INTO device_auth_tokens(device_id,role,token,scopes_json,updated_at_ms) VALUES('device-1','operator',?,'[]',1)",
    )
    .run(SECRETS.deviceToken);
  global
    .prepare("INSERT INTO config_machine_state(state_key,value_json,updated_at_ms) VALUES(?,?,1)")
    .run("authProfiles.main", JSON.stringify({ token: SECRETS.machineState }));
  global
    .prepare(
      "INSERT INTO user_preferences(profile_id,pref_key,value_json,updated_at_ms) VALUES('owner','note',?,1)",
    )
    .run(JSON.stringify(THREAD_MARKER));
  global.close();
  await fs.mkdir(agentDir, { recursive: true });
  const agent = openDatabase(path.join(agentDir, "branch-agent.sqlite"), "agent");
  agent
    .prepare("INSERT INTO auth_profile_store(store_key,store_json,updated_at) VALUES('main',?,1)")
    .run(JSON.stringify({ profiles: { "openai:default": { refresh: SECRETS.authProfile } } }));
  agent
    .prepare("INSERT INTO memory_index_meta(key,value) VALUES('note',?)")
    .run(THREAD_MARKER);
  agent.close();
}

async function seedFiles(home: string, stateDir: string, agentDir: string): Promise<void> {
  // The workspace is the home folder, so it contains the state directory and the agent directory.
  await fs.writeFile(
    path.join(stateDir, "branch.json"),
    JSON.stringify({
      gateway: { auth: { mode: "token", token: SECRETS.configGatewayToken } },
      models: {
        providers: {
          openai: { baseUrl: "https://api.openai.com/v1", apiKey: SECRETS.configApiKey, models: [] },
        },
      },
      channels: { telegram: { botToken: SECRETS.configBotToken } },
      agents: { ownership: "explicit", entries: { main: { workspace: home } } },
    }),
  );
  await fs.mkdir(path.join(stateDir, "credentials"), { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "credentials", "oauth.json"),
    JSON.stringify({ refresh: SECRETS.credentialsDir }),
  );
  await fs.writeFile(path.join(stateDir, ".env"), `OPENAI_API_KEY=${SECRETS.stateEnv}\n`);
  await fs.writeFile(
    path.join(agentDir, "auth-profiles.json"),
    JSON.stringify({ token: SECRETS.authProfileFile }),
  );
  await fs.mkdir(path.join(home, "memory"), { recursive: true });
  await fs.writeFile(path.join(home, "MEMORY.md"), `# Memory\n${MEMORY_MARKER}\n`);
  await fs.writeFile(path.join(home, "memory", "2026-10-05.md"), `${MEMORY_MARKER}\n`);
  await fs.writeFile(path.join(home, ".env"), `ANTHROPIC_API_KEY=${SECRETS.workspaceEnv}\n`);
  await fs.writeFile(path.join(home, "deploy.pem"), SECRETS.pemKey);
  // A workspace .gitignore must not drop backed-up files.
  await fs.writeFile(path.join(home, ".gitignore"), "*.md\n");
}

describe("scheduled backup excludes every secret", () => {
  let home: TempHomeEnv;
  let outside: string;

  beforeEach(async () => {
    resetConfigRuntimeState();
    home = await createTempHomeEnv("backup-no-secrets-");
    outside = await fs.mkdtemp(`${home.home}-out-`);
    const stateDir = path.join(home.home, ".branch");
    vi.stubEnv("BRANCH_CONFIG_PATH", path.join(stateDir, "branch.json"));
    vi.stubEnv("BRANCH_DISABLE_BUNDLED_PLUGINS", "1");
    for (const key of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) {
      vi.stubEnv(key, "Branch Backup Test");
    }
    for (const key of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
      vi.stubEnv(key, "test@example.invalid");
    }
    const agentDir = path.join(stateDir, "agents", "main", "agent");
    await seedDatabases(stateDir, agentDir);
    await seedFiles(home.home, stateDir, agentDir);
  });

  afterEach(async () => {
    resetConfigRuntimeState();
    vi.unstubAllEnvs();
    await fs.rm(outside, { recursive: true, force: true });
    await home.restore();
  });

  async function runBackup(excludeSecrets: boolean) {
    const remote = path.join(outside, excludeSecrets ? "remote.git" : "control-remote.git");
    execFileSync("git", ["init", "--bare", remote], { windowsHide: true });
    const stateDir = path.join(home.home, ".branch");
    const { repository, push } = await prepareBackupDestination(
      { kind: "git", url: remote },
      stateDir,
    );
    const result = await backupGitCreateCommand(createTestRuntime(), {
      repository,
      all: true,
      push,
      excludeSecrets,
      files: true,
    });
    return { repository, remote, result };
  }

  it("pushes threads, memory and redacted config to the backups branch with no secret anywhere", async () => {
    const { repository, remote, result } = await runBackup(true);
    expect(result.pushed).toBe(true);
    expect(result.files?.config).toBe(true);
    const tree = git(remote, ["ls-tree", "-r", "--name-only", "backups"]).split("\n");
    expect(tree).toEqual(
      expect.arrayContaining([
        "global/manifest.json",
        "agents/main/manifest.json",
        "files/manifest.json",
        "files/config/branch.json",
        "files/workspaces/main/MEMORY.md",
        "files/workspaces/main/memory/2026-10-05.md",
      ]),
    );
    expect(tree.some((entry) => entry.includes(".branch/") || entry.endsWith(".env"))).toBe(false);
    const config = JSON.parse(
      git(remote, ["show", "backups:files/config/branch.json"]),
    ) as Record<string, unknown>;
    expect(config).toHaveProperty("gateway.auth.mode", "token");
    const global = JSON.parse(git(remote, ["show", "backups:global/manifest.json"])) as {
      excludedTables: string[];
    };
    expect(global.excludedTables).toEqual(
      expect.arrayContaining(["secret_store_entries", "device_auth_tokens"]),
    );
    const everything = `${await readEverything(repository)}\n${await readEverything(remote, true)}`;
    expect(everything).toContain(THREAD_MARKER);
    expect(everything).toContain(MEMORY_MARKER);
    expect(findSentinels(everything, Object.values(SECRETS))).toEqual([]);
  });

  it("finds the database sentinels when secrets are kept, so the search is not vacuous", async () => {
    const { repository, remote } = await runBackup(false);
    const everything = `${await readEverything(repository)}\n${await readEverything(remote, true)}`;
    expect(findSentinels(everything, DATABASE_SECRETS)).toEqual(DATABASE_SECRETS);
    // Files and config stay secret-free even in a full-fidelity database backup.
    const fileSecrets = Object.values(SECRETS).filter((s) => !DATABASE_SECRETS.includes(s));
    expect(findSentinels(everything, fileSecrets)).toEqual([]);
  });
});
