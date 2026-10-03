#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Installs a Branch Agent package candidate in Docker, performs Telegram
# onboarding/doctor recovery, then runs the Telegram QA live harness.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "branch-npm-telegram-live-e2e" BRANCH_NPM_TELEGRAM_LIVE_E2E_IMAGE)"
DOCKER_TARGET="${BRANCH_NPM_TELEGRAM_DOCKER_TARGET:-build}"
PACKAGE_SPEC="${BRANCH_NPM_TELEGRAM_PACKAGE_SPEC:-branch@beta}"
PACKAGE_TGZ="${BRANCH_NPM_TELEGRAM_PACKAGE_TGZ:-${BRANCH_CURRENT_PACKAGE_TGZ:-}}"
PACKAGE_DIR="${BRANCH_NPM_TELEGRAM_PACKAGE_DIR:-}"
PREPUBLISH_PLUGIN_REGISTRY_DIR="${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}"
PACKAGE_LABEL="${BRANCH_NPM_TELEGRAM_PACKAGE_LABEL:-}"
RUN_ID="${BRANCH_NPM_TELEGRAM_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
OUTPUT_DIR="${BRANCH_NPM_TELEGRAM_OUTPUT_DIR:-.artifacts/qa-e2e/npm-telegram-live/$RUN_ID}"
case "$OUTPUT_DIR" in
  /*) OUTPUT_DIR_HOST="$OUTPUT_DIR" ;;
  *) OUTPUT_DIR_HOST="$ROOT_DIR/$OUTPUT_DIR" ;;
esac
OUTPUT_DIR_CONTAINER_RELATIVE=".artifacts/qa-e2e/npm-telegram-live-output"
OUTPUT_DIR_CONTAINER="/app/$OUTPUT_DIR_CONTAINER_RELATIVE"
upgrade_scenario="telegram-published-upgrade-bindings"
upgrade_selected=0
selected_scenarios="${BRANCH_NPM_TELEGRAM_SCENARIOS:-}"
case ",${selected_scenarios//[[:space:]]/,}," in
  *",$upgrade_scenario,"*)
    if [ "${BRANCH_NPM_TELEGRAM_SCENARIOS:-}" != "$upgrade_scenario" ]; then
      echo "$upgrade_scenario must run alone against one published baseline" >&2
      exit 1
    fi
    upgrade_selected=1
    ;;
esac

resolve_credential_source() {
  if [ -n "${BRANCH_NPM_TELEGRAM_CREDENTIAL_SOURCE:-}" ]; then
    printf "%s" "$BRANCH_NPM_TELEGRAM_CREDENTIAL_SOURCE"
    return 0
  fi
  if [ -n "${BRANCH_QA_CREDENTIAL_SOURCE:-}" ]; then
    printf "%s" "$BRANCH_QA_CREDENTIAL_SOURCE"
    return 0
  fi
  if [ -n "${CI:-}" ] && [ -n "${BRANCH_QA_CONVEX_SITE_URL:-}" ]; then
    if [ -n "${BRANCH_QA_CONVEX_SECRET_CI:-}" ] || [ -n "${BRANCH_QA_CONVEX_SECRET_MAINTAINER:-}" ]; then
      printf "convex"
      return 0
    fi
  fi
  printf "convex"
}

resolve_credential_role() {
  if [ -n "${BRANCH_NPM_TELEGRAM_CREDENTIAL_ROLE:-}" ]; then
    printf "%s" "$BRANCH_NPM_TELEGRAM_CREDENTIAL_ROLE"
    return 0
  fi
  if [ -n "${BRANCH_QA_CREDENTIAL_ROLE:-}" ]; then
    printf "%s" "$BRANCH_QA_CREDENTIAL_ROLE"
  fi
}

validate_branch_package_spec() {
  local spec="$1"
  if [[ "$spec" == branch@alpha ]]; then
    echo "Alpha releases are retired; use a beta prerelease instead." >&2
    exit 1
  fi
  if [[ "$spec" =~ ^branch@(beta|latest|[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(-[1-9][0-9]*|-(alpha|beta)\.[1-9][0-9]*)?)$ ]]; then
    return 0
  fi
  echo "BRANCH_NPM_TELEGRAM_PACKAGE_SPEC must be branch@beta, branch@latest, or an exact Branch Agent release version; got: $spec" >&2
  exit 1
}

resolve_package_tgz() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return 0
  fi
  if [ ! -f "$candidate" ]; then
    echo "BRANCH_NPM_TELEGRAM_PACKAGE_TGZ must point to an existing .tgz file; got: $candidate" >&2
    exit 1
  fi
  case "$candidate" in
    *.tgz) ;;
    *)
      echo "BRANCH_NPM_TELEGRAM_PACKAGE_TGZ must point to a .tgz file; got: $candidate" >&2
      exit 1
      ;;
  esac
  local dir
  local base
  dir="$(cd "$(dirname "$candidate")" && pwd)"
  base="$(basename "$candidate")"
  printf "%s/%s" "$dir" "$base"
}

resolve_package_dir() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return 0
  fi
  if [ ! -d "$candidate" ]; then
    echo "BRANCH_NPM_TELEGRAM_PACKAGE_DIR must point to an existing directory; got: $candidate" >&2
    exit 1
  fi
  (cd "$candidate" && pwd)
}

resolve_prepublish_plugin_registry_dir() {
  local candidate="$1"
  if [ -z "$candidate" ]; then
    return 0
  fi
  if [ ! -d "$candidate" ]; then
    echo "BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR must point to an existing directory; got: $candidate" >&2
    exit 1
  fi
  (cd "$candidate" && pwd)
}

read_package_version() {
  tar -xOf "$1" package/package.json |
    node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const version = JSON.parse(raw).version;
  if (typeof version !== "string" || !version) {
    throw new Error("package tarball is missing a version");
  }
  process.stdout.write(version);
});
'
}

package_mount_args=()
registry_helper_mount_args=()
prepublish_registry_mount_args=()
package_install_source="$PACKAGE_SPEC"
package_source_kind="npm-package"
resolved_package_tgz="$(resolve_package_tgz "$PACKAGE_TGZ")"
resolved_package_dir="$(resolve_package_dir "$PACKAGE_DIR")"
resolved_prepublish_plugin_registry_dir="$(
  resolve_prepublish_plugin_registry_dir "$PREPUBLISH_PLUGIN_REGISTRY_DIR"
)"
if [ -n "$resolved_package_dir" ]; then
  if [ -z "$resolved_package_tgz" ]; then
    echo "BRANCH_NPM_TELEGRAM_PACKAGE_DIR requires BRANCH_NPM_TELEGRAM_PACKAGE_TGZ" >&2
    exit 1
  fi
  case "$resolved_package_tgz" in
    "$resolved_package_dir"/*) ;;
    *)
      echo "BRANCH_NPM_TELEGRAM_PACKAGE_TGZ must be inside BRANCH_NPM_TELEGRAM_PACKAGE_DIR" >&2
      exit 1
      ;;
  esac
  package_install_source="branch@$(read_package_version "$resolved_package_tgz")"
  package_source_kind="prepared-package-set"
  package_mount_args=(-v "$resolved_package_dir:/package-under-test:ro")
  registry_helper_mount_args=(
    -v "$ROOT_DIR/scripts/lib/bounded-response.mjs:/tmp/lib/bounded-response.mjs:ro"
    -v "$ROOT_DIR/scripts/e2e/lib/plugins/npm-registry-server.mjs:/tmp/branch-e2e/lib/plugins/npm-registry-server.mjs:ro"
  )
elif [ -n "$resolved_package_tgz" ]; then
  package_install_source="/package-under-test/$(basename "$resolved_package_tgz")"
  package_source_kind="packed-tarball"
  package_mount_args=(-v "$resolved_package_tgz:$package_install_source:ro")
else
  validate_branch_package_spec "$PACKAGE_SPEC"
fi
if [ -n "$resolved_prepublish_plugin_registry_dir" ]; then
  branch_prepublish_plugin_registry_configure_docker_args "$resolved_prepublish_plugin_registry_dir"
  prepublish_registry_mount_args=("${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}")
fi
if [ -z "$PACKAGE_LABEL" ]; then
  if [ -n "$resolved_package_tgz" ]; then
    PACKAGE_LABEL="$(basename "$resolved_package_tgz")"
  else
    PACKAGE_LABEL="$PACKAGE_SPEC"
  fi
fi

upgrade_mount_args=()
upgrade_candidate=""
package_install_label="$PACKAGE_LABEL"
if [ "$upgrade_selected" = "1" ]; then
  if [ "${BRANCH_NPM_TELEGRAM_PROVIDER_MODE:-mock-openai}" != "mock-openai" ]; then
    echo "$upgrade_scenario requires the deterministic mock-openai provider" >&2
    exit 1
  fi
  if [ -z "$resolved_package_tgz" ] || [ -n "$resolved_package_dir" ]; then
    echo "$upgrade_scenario requires one candidate tarball, not a package set" >&2
    exit 1
  fi
  if [[ ! "$PACKAGE_SPEC" =~ ^branch@[0-9]{4}\.[1-9][0-9]*\.[1-9][0-9]*(-[1-9][0-9]*|-(alpha|beta)\.[1-9][0-9]*)?$ ]]; then
    echo "$upgrade_scenario requires package_spec to name an exact published baseline" >&2
    exit 1
  fi
  # Install the published driver before credentials enter the runtime container.
  # The candidate remains immutable until that driver's normal update command.
  upgrade_candidate="$package_install_source"
  upgrade_mount_args=("${package_mount_args[@]}")
  package_install_source="$PACKAGE_SPEC"
  package_install_label="$PACKAGE_SPEC (published upgrade baseline)"
fi

credential_source="$(resolve_credential_source)"
credential_role="$(resolve_credential_role)"
if [ -z "$credential_role" ] && [ "$credential_source" = "convex" ]; then
  if [ -n "${CI:-}" ]; then
    credential_role="ci"
  else
    credential_role="maintainer"
  fi
fi

validate_credential_preflight() {
  if [ "${BRANCH_NPM_TELEGRAM_SKIP_CREDENTIAL_PREFLIGHT:-0}" = "1" ]; then
    return 0
  fi
  if [ "$credential_source" = "convex" ]; then
    if [ -z "${BRANCH_QA_CONVEX_SITE_URL:-}" ]; then
      echo "Missing required env for Convex credential mode: BRANCH_QA_CONVEX_SITE_URL" >&2
      exit 1
    fi
    if [ "$credential_role" = "ci" ]; then
      if [ -z "${BRANCH_QA_CONVEX_SECRET_CI:-}" ]; then
        echo "Missing required env for Convex ci credential mode: BRANCH_QA_CONVEX_SECRET_CI" >&2
        exit 1
      fi
      return 0
    fi
    if [ "$credential_role" = "maintainer" ]; then
      if [ -z "${BRANCH_QA_CONVEX_SECRET_MAINTAINER:-}" ]; then
        echo "Missing required env for Convex maintainer credential mode: BRANCH_QA_CONVEX_SECRET_MAINTAINER" >&2
        exit 1
      fi
      return 0
    fi
    if [ -z "${BRANCH_QA_CONVEX_SECRET_CI:-}" ] && [ -z "${BRANCH_QA_CONVEX_SECRET_MAINTAINER:-}" ]; then
      echo "Missing required env for Convex credential mode: BRANCH_QA_CONVEX_SECRET_CI or BRANCH_QA_CONVEX_SECRET_MAINTAINER" >&2
      exit 1
    fi
    return 0
  fi

  echo "Telegram package QA requires Convex credential mode." >&2
  exit 1
}

validate_credential_preflight

docker_e2e_build_or_reuse "$IMAGE_NAME" npm-telegram-live "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

mkdir -p "$ROOT_DIR/.artifacts/qa-e2e"
mkdir -p "$OUTPUT_DIR_HOST"
npm_prefix_host="$(mktemp -d "$ROOT_DIR/.artifacts/qa-e2e/npm-telegram-live-prefix.XXXXXX")"
harness_root="$(mktemp -d "$ROOT_DIR/.artifacts/qa-e2e/npm-telegram-live-harness.XXXXXX")"
harness_package_json="$harness_root/package.json"
cp "$ROOT_DIR/package.json" "$harness_package_json"
node --import tsx "$ROOT_DIR/scripts/e2e/lib/npm-telegram-live/prepare-package.mts" "$harness_package_json"
cleanup() {
  local rc=$?
  trap - EXIT
  printf 'schema=1\nexit_code=%s\nlive_output=job_log\n' "$rc" > "$OUTPUT_DIR_HOST/run-metadata.txt"
  rm -rf "$npm_prefix_host"
  rm -rf "$harness_root"
  exit "$rc"
}
trap cleanup EXIT

docker_env=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e BRANCH_E2E_COMMAND_TIMEOUT="${BRANCH_E2E_COMMAND_TIMEOUT:-300s}"
  -e TMPDIR=/tmp
  -e BRANCH_NPM_TELEGRAM_PACKAGE_SPEC="$PACKAGE_SPEC"
  -e BRANCH_NPM_TELEGRAM_PACKAGE_LABEL="$PACKAGE_LABEL"
  -e BRANCH_NPM_TELEGRAM_OUTPUT_DIR="$OUTPUT_DIR_CONTAINER_RELATIVE"
  -e BRANCH_QA_PACKAGE_SOURCE="$package_install_source"
  -e BRANCH_QA_PACKAGE_SOURCE_KIND="$package_source_kind"
  -e BRANCH_QA_RUNNER="${BRANCH_QA_RUNNER:-docker}"
  -e BRANCH_NPM_TELEGRAM_FAST="${BRANCH_NPM_TELEGRAM_FAST:-1}"
  -e BRANCH_NPM_TELEGRAM_UPGRADE_CANDIDATE="$upgrade_candidate"
)

forward_env_if_set() {
  local key="$1"
  if [ -n "${!key:-}" ]; then
    docker_env+=(-e "$key")
  fi
}

if [ -n "$credential_source" ]; then
  docker_env+=(-e BRANCH_QA_CREDENTIAL_SOURCE="$credential_source")
fi
if [ -n "$credential_role" ]; then
  docker_env+=(-e BRANCH_QA_CREDENTIAL_ROLE="$credential_role")
fi
for key in \
  OPENAI_API_KEY \
  ANTHROPIC_API_KEY \
  GEMINI_API_KEY \
  GOOGLE_API_KEY \
  BRANCH_LIVE_OPENAI_KEY \
  BRANCH_LIVE_ANTHROPIC_KEY \
  BRANCH_LIVE_GEMINI_KEY \
  BRANCH_QA_CONVEX_SITE_URL \
  BRANCH_QA_CONVEX_SECRET_CI \
  BRANCH_QA_CONVEX_SECRET_MAINTAINER \
  BRANCH_QA_CREDENTIAL_LEASE_TTL_MS \
  BRANCH_QA_CREDENTIAL_HEARTBEAT_INTERVAL_MS \
  BRANCH_QA_CREDENTIAL_ACQUIRE_TIMEOUT_MS \
  BRANCH_QA_CREDENTIAL_HTTP_TIMEOUT_MS \
  BRANCH_QA_CONVEX_ENDPOINT_PREFIX \
  BRANCH_QA_CREDENTIAL_OWNER_ID \
  BRANCH_QA_ALLOW_INSECURE_HTTP \
  BRANCH_QA_REDACT_PUBLIC_METADATA \
  BRANCH_QA_PACKAGE_SOURCE_SHA \
  BRANCH_QA_TELEGRAM_CANARY_TIMEOUT_MS \
  BRANCH_QA_TELEGRAM_SCENARIO_TIMEOUT_MS \
  BRANCH_QA_SUITE_PROGRESS \
  BRANCH_NPM_TELEGRAM_PROVIDER_MODE \
  BRANCH_NPM_TELEGRAM_MODEL \
  BRANCH_NPM_TELEGRAM_ALT_MODEL \
  BRANCH_NPM_TELEGRAM_SCENARIOS \
  BRANCH_NPM_TELEGRAM_OMIT_DEFAULT_SCENARIOS \
  BRANCH_NPM_TELEGRAM_RTT_SAMPLES \
  BRANCH_NPM_TELEGRAM_RTT_CHECKS \
  BRANCH_NPM_TELEGRAM_RTT_TIMEOUT_MS \
  BRANCH_NPM_TELEGRAM_RTT_MAX_FAILURES \
  BRANCH_NPM_TELEGRAM_SKIP_HOTPATH \
  BRANCH_NPM_TELEGRAM_SUT_ACCOUNT \
  BRANCH_NPM_TELEGRAM_ALLOW_FAILURES \
  BRANCH_ALLOW_OLDER_BINARY_DESTRUCTIVE_ACTIONS; do
  forward_env_if_set "$key"
done

echo "Running package Telegram live Docker E2E ($PACKAGE_LABEL)..."
run_logged_print_heartbeat "npm-telegram-package-install" 60 docker_e2e_docker_run_cmd run --rm \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e BRANCH_E2E_NPM_INSTALL_TIMEOUT="${BRANCH_E2E_NPM_INSTALL_TIMEOUT:-600s}" \
  -e BRANCH_NPM_TELEGRAM_INSTALL_SOURCE="$package_install_source" \
  -e BRANCH_NPM_TELEGRAM_PACKAGE_LABEL="$package_install_label" \
  -e BRANCH_NPM_TELEGRAM_INSTALL_PUBLISHED_BASELINE="$upgrade_selected" \
  -e BRANCH_NPM_TELEGRAM_PACKAGE_SET="$([ -n "$resolved_package_dir" ] && printf 1 || printf 0)" \
  ${package_mount_args[@]+"${package_mount_args[@]}"} \
  ${registry_helper_mount_args[@]+"${registry_helper_mount_args[@]}"} \
  ${prepublish_registry_mount_args[@]+"${prepublish_registry_mount_args[@]}"} \
  -v "$npm_prefix_host:/npm-global" \
  -i "$IMAGE_NAME" bash -s <<'EOF'
set -euo pipefail

if [ "${BRANCH_NPM_TELEGRAM_INSTALL_PUBLISHED_BASELINE:-0}" = "1" ]; then
  source /opt/branch-e2e/scripts/e2e/lib/prepublish-plugin-registry.sh
fi
export HOME="$(mktemp -d "/tmp/branch-npm-telegram-install.XXXXXX")"
export NPM_CONFIG_PREFIX="/npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"

install_source="${BRANCH_NPM_TELEGRAM_INSTALL_SOURCE:?missing BRANCH_NPM_TELEGRAM_INSTALL_SOURCE}"
package_label="${BRANCH_NPM_TELEGRAM_PACKAGE_LABEL:-$install_source}"
echo "Installing ${package_label} from ${install_source}..."

registry_pid=""
registry_log=""
cleanup_registry() {
  if [ -n "$registry_pid" ]; then
    kill "$registry_pid" >/dev/null 2>&1 || true
    wait "$registry_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$registry_log" ]; then
    rm -f "$registry_log"
  fi
}
trap cleanup_registry EXIT

if [ "${BRANCH_NPM_TELEGRAM_PACKAGE_SET:-0}" = "1" ]; then
  shopt -s nullglob
  package_tgzs=(/package-under-test/*.tgz)
  shopt -u nullglob
  if [ "${#package_tgzs[@]}" -eq 0 ]; then
    echo "prepared package set contains no tgz files" >&2
    exit 1
  fi
  registry_args=()
  for package_tgz in "${package_tgzs[@]}"; do
    package_metadata="$(
      tar -xOf "$package_tgz" package/package.json |
        node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  const pkg = JSON.parse(raw);
  if (typeof pkg.name !== "string" || !pkg.name || typeof pkg.version !== "string" || !pkg.version) {
    throw new Error("package tarball is missing name or version");
  }
  process.stdout.write(`${pkg.name}\n${pkg.version}\n`);
});
'
    )"
    package_fields=()
    while IFS= read -r package_field; do
      package_fields+=("$package_field")
    done <<<"$package_metadata"
    registry_args+=("${package_fields[0]}" "${package_fields[1]}" "$package_tgz")
  done
  registry_port_file="$(mktemp)"
  registry_log="$(mktemp)"
  BRANCH_NPM_REGISTRY_UPSTREAM="${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_URL:-https://registry.npmjs.org}" \
    node /tmp/branch-e2e/lib/plugins/npm-registry-server.mjs \
    "$registry_port_file" \
    "${registry_args[@]}" >"$registry_log" 2>&1 &
  registry_pid=$!
  for _ in $(seq 1 100); do
    if [ -s "$registry_port_file" ]; then
      break
    fi
    if ! kill -0 "$registry_pid" >/dev/null 2>&1; then
      cat "$registry_log" >&2
      exit 1
    fi
    sleep 0.1
  done
  if [ ! -s "$registry_port_file" ]; then
    cat "$registry_log" >&2
    echo "prepared package registry did not start" >&2
    exit 1
  fi
  registry_url="http://127.0.0.1:$(cat "$registry_port_file")"
  rm -f "$registry_port_file"
  export NPM_CONFIG_REGISTRY="$registry_url"
  export npm_config_registry="$registry_url"
fi

npm_install_timeout="${BRANCH_E2E_NPM_INSTALL_TIMEOUT:-600s}"
run_npm_install() {
  if [ -z "$npm_install_timeout" ] || [ "$npm_install_timeout" = "0" ]; then
    npm install -g "$install_source" --no-fund --no-audit
    return
  fi

  local timeout_bin=""
  if command -v timeout >/dev/null 2>&1; then
    timeout_bin="timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    timeout_bin="gtimeout"
  fi
  if [ -z "$timeout_bin" ]; then
    echo "timeout or gtimeout is required for BRANCH_E2E_NPM_INSTALL_TIMEOUT=$npm_install_timeout" >&2
    return 127
  fi

  if "$timeout_bin" --kill-after=1s 1s true >/dev/null 2>&1; then
    "$timeout_bin" --kill-after=30s "$npm_install_timeout" npm install -g "$install_source" --no-fund --no-audit
  else
    "$timeout_bin" "$npm_install_timeout" npm install -g "$install_source" --no-fund --no-audit
  fi
}
if [ "${BRANCH_NPM_TELEGRAM_INSTALL_PUBLISHED_BASELINE:-0}" = "1" ]; then
  branch_prepublish_plugin_registry_run_published run_npm_install
else
  run_npm_install
fi

command -v branch
branch --version
EOF

# Mount the trusted current-source QA harness separately from the installed
# package candidate. The candidate remains the absolute CLI/runtime SUT.
command_scenario_mount_args=()
if [ -n "${BRANCH_NPM_TELEGRAM_COMMAND_SCENARIO:-}" ]; then
  if [ ! -f "$BRANCH_NPM_TELEGRAM_COMMAND_SCENARIO" ]; then
    echo "Frozen Telegram command scenario is missing" >&2
    exit 1
  fi
  command_scenario_mount_args=(-v "$BRANCH_NPM_TELEGRAM_COMMAND_SCENARIO:/app/qa/scenarios/channels/telegram-repeated-command-authorization.yaml:ro")
fi
run_logged_print_heartbeat "npm-telegram-live-suite" 60 docker_e2e_run_with_harness \
  "${docker_env[@]}" \
  -v "$ROOT_DIR/.artifacts:/app/.artifacts" \
  -v "$OUTPUT_DIR_HOST:$OUTPUT_DIR_CONTAINER" \
  -v "$harness_package_json:/app/package.json:ro" \
  -v "$harness_package_json:/app/extensions/qa-lab/node_modules/branch/package.json:ro" \
  -v "$ROOT_DIR/dist:/app/dist:ro" \
  -v "$ROOT_DIR/node_modules:/trusted-harness/node_modules:ro" \
  -v "$ROOT_DIR/packages:/app/packages:ro" \
  -v "$ROOT_DIR/extensions:/app/extensions:ro" \
  -v "$ROOT_DIR/.agents:/app/.agents:ro" \
  -v "$ROOT_DIR/taxonomy.yaml:/app/taxonomy.yaml:ro" \
  -v "$ROOT_DIR/qa/scenarios:/app/qa/scenarios:ro" \
  ${command_scenario_mount_args[@]+"${command_scenario_mount_args[@]}"} \
  ${upgrade_mount_args[@]+"${upgrade_mount_args[@]}"} \
  ${prepublish_registry_mount_args[@]+"${prepublish_registry_mount_args[@]}"} \
  -v "$npm_prefix_host:/npm-global" \
  -i "$IMAGE_NAME" bash -s <<'EOF'
set -Eeuo pipefail
source scripts/lib/branch-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh

runtime_home="$(mktemp -d "/tmp/branch-npm-telegram-runtime.XXXXXX")"
export HOME="$runtime_home"
export NPM_CONFIG_PREFIX="/npm-global"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export BRANCH_NPM_TELEGRAM_REPO_ROOT="/app"
export BRANCH_NPM_TELEGRAM_PACKAGE_VERSION="$(node -e 'const pkg = require("/npm-global/lib/node_modules/branch/package.json"); process.stdout.write(pkg.version)')"
sut_command="/npm-global/bin/branch"
plugin_registry_pid=""

cleanup_recovery() {
  branch_e2e_stop_process "${plugin_registry_pid:-}"
}
trap cleanup_recovery EXIT

dump_hotpath_logs() {
  local status="$1"
  echo "installed-package onboarding recovery hot path failed with exit code $status" >&2
  for file in \
    /tmp/branch-npm-telegram-onboard.json \
    /tmp/branch-npm-telegram-codex-install.log \
    /tmp/branch-npm-telegram-channel-add.log \
    /tmp/branch-npm-telegram-doctor-fix.log \
    /tmp/branch-npm-telegram-doctor-check.log \
    /tmp/branch-npm-telegram-plugin-registry/server.log; do
    if [ -f "$file" ]; then
      echo "--- $file ---" >&2
      branch_e2e_print_log "$file" >&2
    fi
  done
}
trap 'status=$?; dump_hotpath_logs "$status"; exit "$status"' ERR

test -x "$sut_command"
branch_e2e_run_command "$sut_command" --version
mkdir -p /app/node_modules
link_harness_dependency() {
  local source="$1"
  local name="$2"
  local target="/app/node_modules/$name"
  mkdir -p "$(dirname "$target")"
  ln -sfnT "$source" "$target"
}

# External dependencies resolve from the trusted install, not the candidate.
for dependency_dir in /trusted-harness/node_modules/* /trusted-harness/node_modules/.[!.]*; do
  [ -e "$dependency_dir" ] || continue
  dependency_name="$(basename "$dependency_dir")"
  case "$dependency_name" in
    .bin | branch)
      continue
      ;;
    @*)
      [ -d "$dependency_dir" ] || continue
      for scoped_dependency_dir in "$dependency_dir"/*; do
        [ -e "$scoped_dependency_dir" ] || continue
        scoped_dependency_name="$(basename "$scoped_dependency_dir")"
        link_harness_dependency \
          "$scoped_dependency_dir" \
          "$dependency_name/$scoped_dependency_name"
      done
      ;;
    *)
      link_harness_dependency "$dependency_dir" "$dependency_name"
      ;;
  esac
done

# Workspace links must resolve under /app even when pnpm linked them relative to
# the checkout path used by the workflow.
for workspace_dir in /app/packages/* /app/extensions/*; do
  [ -f "$workspace_dir/package.json" ] || continue
  workspace_name="$(node -e \
    'const fs = require("node:fs"); const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(pkg.name || "");' \
    "$workspace_dir/package.json")"
  [ -n "$workspace_name" ] || continue
  link_harness_dependency "$workspace_dir" "$workspace_name"
done
link_harness_dependency /app branch

if [ -n "${BRANCH_NPM_TELEGRAM_UPGRADE_CANDIDATE:-}" ]; then
  # The mounted-registry entrypoint already owns this container's registry.
  # The upgrade command preserves its npm settings through the normal updater.
  trap - ERR
  node .agents/skills/telegram-e2e-userbot/scripts/run-published-upgrade-user-e2e.mjs \
    --candidate "$BRANCH_NPM_TELEGRAM_UPGRADE_CANDIDATE" \
    --baseline "$sut_command" \
    --baseline-spec "$BRANCH_NPM_TELEGRAM_PACKAGE_SPEC" \
    --output "$BRANCH_NPM_TELEGRAM_REPO_ROOT/$BRANCH_NPM_TELEGRAM_OUTPUT_DIR"
  exit 0
fi

if [ -n "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  BRANCH_PREPUBLISH_PLUGIN_REGISTRY_REQUIRED_PACKAGES_JSON='["@branch/codex"]' \
    branch_prepublish_plugin_registry_start \
    "$BRANCH_PREPUBLISH_PLUGIN_REGISTRY_DIR" \
    "${BRANCH_DOCKER_E2E_SELECTED_SHA:?missing selected SHA}" \
    "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}" \
    "${BRANCH_PREPUBLISH_PLUGIN_REGISTRY_MANIFEST_SHA256:?missing manifest SHA-256}" \
    /tmp/branch-npm-telegram-plugin-registry \
    plugin_registry_pid
fi

if [ "${BRANCH_NPM_TELEGRAM_SKIP_HOTPATH:-0}" != "1" ]; then
  hotpath_home="$(mktemp -d "/tmp/branch-npm-telegram-hotpath.XXXXXX")"
  export HOME="$hotpath_home"
  echo "Running installed-package onboarding recovery hot path..."
  hotpath_placeholder="branch-npm-telegram-hotpath"
  hotpath_model_value="$(printf '%s%s' s "k-$hotpath_placeholder")"
  if [ -n "${OPENAI_API_KEY:-}" ]; then
    hotpath_model_value="$OPENAI_API_KEY"
  fi
  hotpath_channel_value="$(printf '%s:%s' 123456 "$hotpath_placeholder")"
  # Older packages own their automatic setup. Successful candidate help, not a
  # version guess, establishes whether this harness must preinstall Codex.
  plugin_install_help="$(branch_e2e_run_command "$sut_command" plugins install --help)"
  fixture_consent="$(printf '%s' "$plugin_install_help" | node scripts/e2e/lib/package-compat.mjs fixture-consent)"
  if [ -n "$fixture_consent" ]; then
    branch_e2e_fixture_plugin_command "$sut_command" -- plugins install @branch/codex \
      >/tmp/branch-npm-telegram-codex-install.log 2>&1 </dev/null
  fi
  OPENAI_API_KEY="$hotpath_model_value" branch_e2e_run_command "$sut_command" onboard \
    --non-interactive --accept-risk \
    --mode local \
    --auth-choice openai-api-key \
    --secret-input-mode ref \
    --gateway-port 18789 \
    --gateway-bind loopback \
    --skip-daemon \
    --skip-ui \
    --skip-skills \
    --skip-health \
    --json >/tmp/branch-npm-telegram-onboard.json </dev/null

  branch_e2e_run_command "$sut_command" channels add --channel telegram --token "$hotpath_channel_value" >/tmp/branch-npm-telegram-channel-add.log 2>&1 </dev/null
  branch_e2e_run_command "$sut_command" doctor --fix --non-interactive >/tmp/branch-npm-telegram-doctor-fix.log 2>&1 </dev/null
  branch_e2e_run_command "$sut_command" doctor --non-interactive >/tmp/branch-npm-telegram-doctor-check.log 2>&1 </dev/null
  export HOME="$runtime_home"
fi

export BRANCH_NPM_TELEGRAM_SUT_COMMAND="$sut_command"
trap - ERR
tsx scripts/e2e/npm-telegram-live-runner.ts
EOF

echo "package Telegram live Docker E2E passed ($PACKAGE_LABEL)"
