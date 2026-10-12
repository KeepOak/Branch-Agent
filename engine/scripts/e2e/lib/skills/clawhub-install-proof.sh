#!/usr/bin/env bash
# Live Seedbank skill install proof for package-backed Docker/Testbox lanes.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

source "$ROOT_DIR/scripts/lib/branch-e2e-instance.sh"

BRANCH_TEST_STATE_SCRIPT_B64="${BRANCH_TEST_STATE_SCRIPT_B64:-}"
branch_skill_install_owns_home=0
branch_skill_install_temp_root=""
branch_node_module_path=""
cleanup_clawhub_skill_install_home() {
  if [ -n "$branch_node_module_path" ]; then
    rm -f "$branch_node_module_path"
  fi
  if [ "$branch_skill_install_owns_home" = "1" ] && [ -n "${HOME:-}" ]; then
    rm -rf "$HOME"
  fi
  if [ -n "$branch_skill_install_temp_root" ]; then
    rm -rf "$branch_skill_install_temp_root"
  fi
}
trap cleanup_clawhub_skill_install_home EXIT

# TODO: Use Node's stdin entrypoint again after Bun accepts `--input-type=module -`.
run_node_module() {
  local exit_code=0
  branch_node_module_path="$(mktemp "$branch_skill_install_temp_root/node-module.XXXXXX.mjs")"
  cat >"$branch_node_module_path"
  node "$branch_node_module_path" "$@" || exit_code=$?
  rm -f "$branch_node_module_path"
  branch_node_module_path=""
  return "$exit_code"
}

if [ -n "$BRANCH_TEST_STATE_SCRIPT_B64" ]; then
  branch_e2e_eval_test_state_from_b64 "$BRANCH_TEST_STATE_SCRIPT_B64"
else
  export HOME="$(mktemp -d "${TMPDIR:-/tmp}/branch-skill-install-home.XXXXXX")"
  branch_skill_install_owns_home=1
  export USERPROFILE="$HOME"
  export BRANCH_HOME="$HOME"
  export BRANCH_STATE_DIR="$HOME/.branch"
  export BRANCH_CONFIG_PATH="$BRANCH_STATE_DIR/branch.json"
  mkdir -p "$BRANCH_STATE_DIR"
fi
branch_skill_install_temp_root="$(mktemp -d "${TMPDIR:-/tmp}/branch-skill-install.XXXXXX")"
npm_log="$branch_skill_install_temp_root/npm.log"
build_log="$branch_skill_install_temp_root/build.log"

if [ -n "${BRANCH_CURRENT_PACKAGE_TGZ:-}" ]; then
  export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
  export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
  branch_e2e_install_package "$npm_log"
fi

if [ -n "${BRANCH_CURRENT_PACKAGE_TGZ:-}" ] && command -v branch >/dev/null 2>&1; then
  BRANCH_CMD=(branch)
elif command -v pnpm >/dev/null 2>&1 && [ -f package.json ]; then
  if [ "${BRANCH_SKILL_INSTALL_E2E_BUILD_SOURCE:-0}" = "1" ]; then
    pnpm build >"$build_log" 2>&1
  fi
  BRANCH_CMD=(pnpm --silent branch)
elif command -v branch >/dev/null 2>&1; then
  BRANCH_CMD=(branch)
else
  echo "branch command not found; install package first or run from repo with pnpm" >&2
  exit 1
fi

mkdir -p "$(dirname "$BRANCH_CONFIG_PATH")"
run_node_module "$BRANCH_CONFIG_PATH" <<'NODE'
import fs from "node:fs";
const configPath = process.argv[2];
let config = {};
try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {}
config.skills ??= {};
config.skills.install ??= {};
config.skills.install.allowUploadedArchives = false;
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
NODE

query="${BRANCH_SKILL_INSTALL_E2E_QUERY:-homeassistant}"
requested_slug="${BRANCH_SKILL_INSTALL_E2E_SLUG:-}"
preferred_slug="${BRANCH_SKILL_INSTALL_E2E_PREFERRED_SLUG:-homeassistant-skill}"
maintained_fixture=0
if [ -z "${BRANCH_SKILL_INSTALL_E2E_QUERY:-}" ] &&
  [ -z "${BRANCH_SKILL_INSTALL_E2E_SLUG:-}" ] &&
  [ -z "${BRANCH_SKILL_INSTALL_E2E_PREFERRED_SLUG:-}" ]; then
  maintained_fixture=1
  query="gifgrep"
  requested_slug="gifgrep"
fi
search_json="$branch_skill_install_temp_root/search.json"
resolve_json="$branch_skill_install_temp_root/resolved.json"
install_log="$branch_skill_install_temp_root/install.log"
info_json="$branch_skill_install_temp_root/info.json"

echo "Searching live Seedbank skills for: $query"
"${BRANCH_CMD[@]}" skills search "$query" --limit 8 --json >"$search_json"

run_node_module "$search_json" "$resolve_json" "$requested_slug" "$preferred_slug" "$maintained_fixture" <<'NODE'
import fs from "node:fs";
const [searchPath, resolvePath, requestedSlug, preferredSlug, maintainedFixture] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(searchPath, "utf8"));
const results = Array.isArray(payload) ? payload : Array.isArray(payload.results) ? payload.results : [];
const slugs = results.map((entry) => String(entry.slug ?? "")).filter(Boolean);
const hasExplicitRisk = (entry) =>
  String(entry?.trust?.clawHubVerdict ?? "").toLowerCase() === "suspicious" ||
  entry?.native?.skill?.isSuspicious === true;
let candidates;
if (maintainedFixture === "1") {
  const maintained = results.find((entry) => {
    if (hasExplicitRisk(entry)) return false;
    if (entry?.slug !== "gifgrep" || entry.ownerHandle !== "steipete") return false;
    const hasMappedRef = Object.hasOwn(entry, "installRef");
    const hasRawIdentity = Object.hasOwn(entry, "source") || Object.hasOwn(entry, "install");
    return (hasMappedRef || hasRawIdentity) &&
      (!hasMappedRef || entry.installRef === "@steipete/gifgrep") &&
      (!hasRawIdentity || (entry.source === "clawhub" &&
        entry.install?.kind === "clawhub" &&
        entry.install?.reference === "steipete/gifgrep"));
  });
  if (!maintained) {
    throw new Error("Maintained Seedbank fixture @steipete/gifgrep not found with matching search identity");
  }
  candidates = [maintained];
} else if (requestedSlug) {
  const requested = results.find((entry) => entry.slug === requestedSlug);
  if (!requested) {
    throw new Error(`Requested skill slug ${requestedSlug} not found. Search returned: ${slugs.join(", ") || "(none)"}`);
  }
  candidates = [requested];
} else {
  const safeResults = results.filter((entry) => !hasExplicitRisk(entry));
  const preferred = safeResults.find((entry) => entry.slug === preferredSlug);
  const homeassistant = safeResults.find((entry) => String(entry.slug ?? "").includes("homeassistant"));
  candidates = [preferred, homeassistant, ...safeResults]
    .filter((entry, index, ordered) => entry && ordered.indexOf(entry) === index);
}
if (!candidates[0]?.slug) {
  throw new Error(`No non-suspicious skill slug found. Search returned: ${slugs.join(", ") || "(none)"}`);
}
fs.writeFileSync(resolvePath, `${JSON.stringify({
  candidates: candidates.map((entry) => ({
    slug: entry.slug,
    installRef: maintainedFixture === "1" ? "@steipete/gifgrep" : entry.installRef ?? entry.slug,
    version: entry.version ?? null,
    displayName: entry.displayName ?? entry.name ?? entry.slug,
  })),
})}\n`);
NODE

slug=""
install_ref=""
while IFS=$'\t' read -r candidate_slug candidate_install_ref; do
  echo "Installing live Seedbank skill: $candidate_slug"
  install_args=("$candidate_install_ref")
  if [ "$maintained_fixture" = "1" ]; then
    install_args=("@steipete/gifgrep" --version 1.0.1)
  fi
  if "${BRANCH_CMD[@]}" skills install "${install_args[@]}" --force >"$install_log" 2>&1; then
    slug="$candidate_slug"
    install_ref="$candidate_install_ref"
    break
  fi
  if [ -z "$requested_slug" ] && {
    { grep -Fq "Seedbank Security Audit" "$install_log" && grep -Eq "Outcome: .*Blocked" "$install_log"; } ||
      { grep -Fq "Seedbank found security risks" "$install_log" &&
        grep -Fq "Update cancelled; rerun with --acknowledge-clawhub-risk" "$install_log"; }
  }; then
    echo "Skipping live Seedbank skill with current security findings: $candidate_slug"
    continue
  fi
  echo "Skill install failed" >&2
  branch_e2e_dump_logs "$npm_log" "$search_json" "$resolve_json" "$install_log"
  exit 1
done < <(node -e '
  const payload = JSON.parse(require("node:fs").readFileSync(process.argv.at(-1), "utf8"));
  for (const candidate of payload.candidates) {
    process.stdout.write(`${candidate.slug}\t${candidate.installRef}\n`);
  }
' "$resolve_json")
if [ -z "$slug" ]; then
  echo "No live Seedbank search candidate passed current security checks" >&2
  branch_e2e_dump_logs "$npm_log" "$search_json" "$resolve_json" "$install_log"
  exit 1
fi

workspace_dir="$HOME/.branch/workspace"
skill_dir="$workspace_dir/skills/$slug"
origin_json="$skill_dir/.clawhub/origin.json"
lock_json="$workspace_dir/.clawhub/lock.json"

branch_e2e_assert_file "$skill_dir/SKILL.md"
branch_e2e_assert_file "$origin_json"
branch_e2e_assert_file "$lock_json"

"${BRANCH_CMD[@]}" skills info "$slug" --json >"$info_json"

run_node_module "$BRANCH_CONFIG_PATH" "$skill_dir" "$origin_json" "$lock_json" "$info_json" "$slug" "$maintained_fixture" <<'NODE'
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const [configPath, skillDir, originPath, lockPath, infoPath, slug, maintainedFixture] = process.argv.slice(2);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
const config = read(configPath);
if (config.skills?.install?.allowUploadedArchives !== false) {
  throw new Error("skills.install.allowUploadedArchives must remain false during Seedbank install proof");
}
const origin = read(originPath);
if (origin.slug !== slug || origin.registry !== "https://clawhub.ai" || !origin.installedVersion) {
  throw new Error(`Unexpected origin metadata: ${JSON.stringify(origin)}`);
}
const lock = read(lockPath);
if (lock.skills?.[slug]?.version !== origin.installedVersion) {
  throw new Error(`Lockfile missing ${slug}@${origin.installedVersion}`);
}
if (maintainedFixture === "1" && (
  origin.ownerHandle !== "steipete" || lock.skills[slug].ownerHandle !== "steipete" ||
  origin.installedVersion !== "1.0.1"
)) {
  throw new Error("Maintained Seedbank fixture origin/lock must identify @steipete/gifgrep@1.0.1");
}
const info = read(infoPath);
const infoFilePath = info.filePath ?? info.skill?.filePath;
const infoBaseDir = info.baseDir ?? info.skill?.baseDir;
if (
  info.skillKey !== slug &&
  (!infoFilePath || !isPathInside(skillDir, infoFilePath))
) {
  throw new Error(`skills info did not report installed skill ${slug}: ${JSON.stringify(info)}`);
}
if (infoBaseDir && path.resolve(infoBaseDir) !== path.resolve(skillDir)) {
  throw new Error(`skills info reported unexpected baseDir: ${infoBaseDir}`);
}
const skillBytes = fs.readFileSync(path.join(skillDir, "SKILL.md"));
if (maintainedFixture === "1" &&
  createHash("sha256").update(skillBytes).digest("hex") !==
    "1cf64ee164ffffac317b7156d0c107cff8714abe4ae6438387cf27d4a513890c") {
  throw new Error("Maintained Seedbank fixture SKILL.md differs from the reviewed 1.0.1 source");
}
const skillText = skillBytes.toString("utf8");
if (!/^name:\s*/m.test(skillText)) {
  throw new Error("Installed SKILL.md is missing frontmatter name");
}
process.stdout.write(`E2E_OK installed=${slug} version=${origin.installedVersion} uploadArchives=false\n`);
NODE
