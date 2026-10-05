// Test Live Codex Harness Docker tests cover test live codex harness docker script behavior.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();

const SCRIPT_PATH = path.resolve(
  import.meta.dirname,
  "../../scripts/test-live-codex-harness-docker.sh",
);

describe("scripts/test-live-codex-harness-docker.sh", () => {
  it("delivers native V2 subagent defaults and preserves explicit app-server arguments", () => {
    const root = createTempDir("branch-codex-native-args-");
    for (const dir of ["scripts", "bin", "home", "runtime"]) {
      fs.mkdirSync(path.join(root, dir));
    }
    fs.symlinkSync(path.resolve("scripts/lib"), path.join(root, "scripts/lib"));
    fs.writeFileSync(
      path.join(root, "scripts/test-live-build-docker.sh"),
      "#!/bin/bash\nexit 0\n",
      {
        mode: 0o755,
      },
    );
    fs.writeFileSync(
      path.join(root, "bin/docker"),
      `#!/bin/bash
case "$1" in
  info) printf '["name=seccomp"]\\n' ;;
  run) printf '%s\\0' "$@" >"$CAPTURE" ;;
esac
`,
      { mode: 0o755 },
    );
    const nativeV2Args = "app-server --listen stdio:// -c features.multi_agent_v2=true";
    const explicitArgs = 'app-server --listen stdio:// -c model="caller model"';
    const cases: Array<{ env: Record<string, string>; expected: string }> = [
      { env: {}, expected: nativeV2Args },
      { env: { BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE: "yes" }, expected: nativeV2Args },
      { env: { BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE: "0" }, expected: "" },
      { env: { BRANCH_CODEX_APP_SERVER_ARGS: explicitArgs }, expected: explicitArgs },
    ];
    const capture = path.join(root, "docker-args");
    for (const testCase of cases) {
      const result = spawnSync("/bin/bash", [SCRIPT_PATH], {
        encoding: "utf8",
        env: {
          HOME: path.join(root, "home"),
          PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
          RUNNER_TEMP: path.join(root, "runtime"),
          CI: "true",
          CAPTURE: capture,
          OPENAI_API_KEY: "test-openai-key",
          BRANCH_LIVE_CODEX_HARNESS_AUTH: "api-key",
          BRANCH_LIVE_DOCKER_TRUSTED_HARNESS_DIR: root,
          ...testCase.env,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const argv = fs.readFileSync(capture, "utf8").split("\0");
      expect(argv[0]).toBe("run");
      const forwardedEnv = argv.flatMap((arg, index) => (arg === "-e" ? [argv[index + 1]] : []));
      expect(forwardedEnv).toContain(`BRANCH_CODEX_APP_SERVER_ARGS=${testCase.expected}`);
    }
  });

  it("retains the Codex auth, isolation, forwarding, and diagnostic contracts", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    const authHelper = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../scripts/lib/live-docker-auth.sh"),
      "utf8",
    );

    for (const required of [
      'DOCKER_CACHE_CONTAINER_DIR="/tmp/branch-cache"',
      'DOCKER_CLI_TOOLS_CONTAINER_DIR="/tmp/branch-npm-global"',
      "branch_live_init_cli_tools_dir",
      "branch_live_init_cache_home_dir",
      '-e XDG_CACHE_HOME="$DOCKER_CACHE_CONTAINER_DIR"',
      '-e NPM_CONFIG_PREFIX="$DOCKER_CLI_TOOLS_CONTAINER_DIR"',
      "if branch_live_uses_managed_bind_dirs; then",
      '-v "$CACHE_HOME_DIR":"$DOCKER_CACHE_CONTAINER_DIR"',
      '-v "$CLI_TOOLS_DIR":"$DOCKER_CLI_TOOLS_CONTAINER_DIR"',
      "BRANCH_LIVE_CODEX_HARNESS_AUTH=codex-auth requires ~/.codex/auth.json before building the live Docker image",
      "If this is a Testbox/API-key run, set BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key and run through branch-testbox-env.",
      "printf 'OPENAI_API_KEY=%s\\n' \"${OPENAI_API_KEY}\"",
      "printf 'CODEX_API_KEY=%s\\n' \"${CODEX_API_KEY:-$OPENAI_API_KEY}\"",
      "branch_live_init_managed_home",
      'if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then',
      'if [[ -z "${DOCKER_HOME_DIR:-}" ]]; then',
      'DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/branch-docker-home.XXXXXX")"',
      'CONFIG_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/branch-docker-config.XXXXXX")"',
      'WORKSPACE_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/branch-docker-workspace.XXXXXX")"',
      'DOCKER_CACHE_CONTAINER_DIR="/home/node/.cache"',
      'DOCKER_CLI_TOOLS_CONTAINER_DIR="/home/node/.npm-global"',
      'PROFILE_STATUS="api-key-env"',
      'chmod 0777 "$DOCKER_HOME_DIR" "$CONFIG_DIR" "$WORKSPACE_DIR" || true',
      'if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" ]]; then',
      "cleanup_codex_live_mounts() {",
      'chmod -R a+rwX "$HOME" "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" 2>/dev/null || true',
      "trap cleanup_codex_live_mounts EXIT",
      '"$ROOT_DIR/extensions/codex/package.json"',
      "process.stdout.write(`@openai/codex@${version}`);",
      '-e BRANCH_LIVE_CODEX_CLI_PACKAGE_SPEC="$CODEX_CLI_PACKAGE_SPEC"',
      'run_setup_command npm install -g "$BRANCH_LIVE_CODEX_CLI_PACKAGE_SPEC"',
      "Failed to extract accountId from token",
      "ERROR: Codex auth cannot extract accountId from the available token; refresh BRANCH_CODEX_AUTH_JSON or use BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key.",
      'tail -c 262144 "$codex_preflight_log"',
    ]) {
      expect(script).toContain(required);
    }

    for (const dockerArg of [
      '-e BRANCH_LIVE_CODEX_BIND_PROVIDER="${BRANCH_LIVE_CODEX_BIND_PROVIDER:-}"',
      '-e BRANCH_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS="${BRANCH_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS:-}"',
      '-e BRANCH_LIVE_CODEX_BIND_TIMEOUT_MS="${BRANCH_LIVE_CODEX_BIND_TIMEOUT_MS:-}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE="${BRANCH_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE:-0}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS="${BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS:-0}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_EXPECTED_EFFORT="${BRANCH_LIVE_CODEX_HARNESS_EXPECTED_EFFORT:-}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS="${BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS:-4}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS="${BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS:-3}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT="${BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT:-1}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS="${BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS:-0}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS="${BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS:-4}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES="${BRANCH_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES:-300000}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_CODE_MODE_ONLY="${BRANCH_LIVE_CODEX_HARNESS_CODE_MODE_ONLY:-0}"',
      '-e BRANCH_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY="${BRANCH_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY:-0}"',
    ]) {
      expect(script).toContain(dockerArg);
    }

    expect(authHelper).toContain("branch_live_is_ci");
    expect(authHelper).toContain('DOCKER_USER="$(id -u):$(id -g)"');
    expect(authHelper).toContain(
      'branch_live_prepare_bind_dir_for_container_user "$CLI_TOOLS_DIR"',
    );
    expect(authHelper).toContain(
      'branch_live_prepare_bind_dir_for_container_user "$CACHE_HOME_DIR"',
    );
    for (const forbidden of [
      '-v "$CACHE_HOME_DIR":/home/node/.cache',
      '-v "$CLI_TOOLS_DIR":/home/node/.npm-global',
      'DOCKER_USER="0:0"',
      "run_setup_command npm install -g @openai/codex",
      "SKIP: Codex auth cannot extract accountId",
      'cat "$codex_preflight_log"',
    ]) {
      expect(script).not.toContain(forbidden);
    }
    for (const [before, after] of [
      ["requires ~/.codex/auth.json before building", 'BRANCH_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR"'],
      ["OPENAI_API_KEY=%s", "CODEX_API_KEY=%s"],
      ['PROFILE_STATUS="api-key-env"', "branch_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT"],
      ["cleanup_codex_live_mounts()", 'mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME"'],
    ] as const) {
      expect(script.indexOf(before)).toBeLessThan(script.indexOf(after));
    }
    expect(script).not.toMatch(/Failed to extract accountId from token[\s\S]{0,180}exit 0/u);
  });

  it("keeps the staged Gateway and Codex plugin on the same source module graph", () => {
    const script = fs.readFileSync(SCRIPT_PATH, "utf8");
    const selection = script
      .split('branch_live_link_runtime_tree "$tmp_dir"\n')[1]
      ?.split('branch_live_stage_state_dir "$tmp_dir/.branch-state"')[0];
    expect(selection).toBeDefined();

    const root = fs.mkdtempSync(
      path.join(process.env.TMPDIR ?? "/tmp", "branch-codex-plugin-roots-"),
    );
    try {
      const stagedRoot = path.join(root, "staged");
      const stagedPlugin = path.join(stagedRoot, "extensions", "codex");
      fs.mkdirSync(stagedPlugin, { recursive: true });
      fs.writeFileSync(path.join(stagedPlugin, "branch.plugin.json"), "{}");
      fs.mkdirSync(path.join(root, "dist-runtime", "extensions", "codex"), {
        recursive: true,
      });
      const executableSelection = selection!
        .replaceAll("/app/dist-runtime", path.join(root, "dist-runtime"))
        .replaceAll("/app/dist", path.join(root, "dist"));
      const result = spawnSync(
        "bash",
        ["-c", `${executableSelection}\nprintf '%s' "$BRANCH_BUNDLED_PLUGINS_DIR"`],
        {
          encoding: "utf8",
          env: { ...process.env, tmp_dir: stagedRoot },
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toBe(path.join(stagedRoot, "extensions"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid setup timeout values before auth or Docker setup", () => {
    const result = spawnSync("bash", [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        ...process.env,
        BRANCH_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS: "180s",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "invalid BRANCH_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS: 180s",
    );
    expect(result.stderr).not.toContain("requires ~/.codex/auth.json");
    expect(result.stderr).not.toContain("docker");
  });
});
