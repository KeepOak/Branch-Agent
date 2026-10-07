import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const ROOT_DIR = process.cwd();
const RUNNER_PATH = join(ROOT_DIR, "scripts/e2e/docker-package-install.sh");

type PackageIdentityOptions = {
  artifactVersion: string;
  nativeContract?: "required" | "not-applicable";
  bunCli?: string;
  bunManifest?: string;
  npmCli?: string;
  npmManifest?: string;
  pnpmCli?: string;
  pnpmManifest?: string;
};

function runPackageIdentity(options: PackageIdentityOptions) {
  const root = tempDirs.make("branch-docker-package-identity-");
  const binDir = join(root, "bin");
  const packageDir = join(root, "package");
  const packageTgz = join(root, "candidate.tgz");
  const identityPath = join(root, "identity.json");
  mkdirSync(binDir);
  mkdirSync(packageDir);
  writeFileSync(
    join(packageDir, "package.json"),
    JSON.stringify({ name: "branch", version: options.artifactVersion }),
  );
  const pack = spawnSync("tar", ["-czf", packageTgz, "-C", root, "package"], {
    encoding: "utf8",
  });
  expect(pack.status, pack.stderr).toBe(0);

  const dockerPath = join(binDir, "docker");
  writeFileSync(
    dockerPath,
    `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  image|run|rm|logs)
    exit 0
    ;;
  exec)
    container="\${1:?missing container}"
    shift
    command_line="$*"
    if [[ "$command_line" == "test -f /tmp/branch-proof-ready" ]]; then
      exit 0
    fi
    if [[ "$command_line" == "cat /tmp/branch-package-root" ]]; then
      printf "/fake/pnpm/branch"
      exit 0
    fi
    if [[ "$command_line" == "cat /tmp/branch-version" ]]; then
      if [[ "$container" == *-npm-proof-* ]]; then
        printf "%s" "$FAKE_NPM_CLI"
      elif [[ "$container" == *-pnpm-proof-* ]]; then
        printf "%s" "$FAKE_PNPM_CLI"
      else
        exit 2
      fi
      exit 0
    fi
    if [[ "$command_line" == *"/tmp/branch-bun-proof.json"* ]]; then
      case "$command_line" in
        *installedPackageRoot*) printf "/fake/bun/branch" ;;
        *installedPackageVersion*) printf "%s" "$FAKE_BUN_MANIFEST" ;;
        *branchVersion*) printf "%s" "$FAKE_BUN_CLI" ;;
        *branchPath*) printf "/fake/bun/bin/branch" ;;
        *) exit 2 ;;
      esac
      exit 0
    fi
    if [[ "$command_line" == *"package.json"* ]]; then
      if [[ "$container" == *-npm-proof-* ]]; then
        printf "%s" "$FAKE_NPM_MANIFEST"
      elif [[ "$container" == *-pnpm-proof-* ]]; then
        printf "%s" "$FAKE_PNPM_MANIFEST"
      else
        exit 2
      fi
      exit 0
    fi
    exit 2
    ;;
  inspect)
    reference="\${!#}"
    printf '[{"Id":"sha256:fake","Image":"sha256:image","Name":"/%s","RepoDigests":[],"State":{"Status":"running"}}]\\n' "$reference"
    ;;
  *)
    exit 2
    ;;
esac
`,
  );
  chmodSync(dockerPath, 0o755);

  const result = spawnSync("/bin/bash", [RUNNER_PATH], {
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_BUN_CLI: options.bunCli ?? `Branch Agent ${options.artifactVersion}`,
      FAKE_BUN_MANIFEST: options.bunManifest ?? options.artifactVersion,
      FAKE_NPM_CLI: options.npmCli ?? `Branch Agent ${options.artifactVersion}`,
      FAKE_NPM_MANIFEST: options.npmManifest ?? options.artifactVersion,
      FAKE_PNPM_CLI: options.pnpmCli ?? `Branch Agent ${options.artifactVersion}`,
      FAKE_PNPM_MANIFEST: options.pnpmManifest ?? options.artifactVersion,
      BRANCH_CURRENT_PACKAGE_TGZ: packageTgz,
      OPENCLAW_FS_SAFE_NATIVE_CONTRACT: options.nativeContract ?? "required",
      BRANCH_DOCKER_ARTIFACT_IDENTITY_PATH: identityPath,
      BRANCH_DOCKER_E2E_DISABLE_RESOURCE_LIMITS: "1",
      BRANCH_SKIP_DOCKER_BUILD: "1",
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    },
  });
  return {
    identity: result.status === 0 ? JSON.parse(readFileSync(identityPath, "utf8")) : undefined,
    result,
  };
}

describe.skipIf(process.platform === "win32")("Docker package identity report", () => {
  it.each(
    (["npm", "pnpm", "bun"] as const).flatMap((manager) => [
      {
        manager,
        field: "Manifest",
        value: "11.2.30",
        diagnostic: "installed manifest version '11.2.30' != artifact '1.2.3'",
      },
      {
        manager,
        field: "Cli",
        value: "Branch Agent 11.2.30 (wrong)",
        diagnostic: "CLI output parses to '11.2.30'",
      },
    ]),
  )(
    "rejects a stale $manager $field version even when it contains the artifact version",
    ({ manager, field, value, diagnostic }) => {
      const { result } = runPackageIdentity({
        artifactVersion: "1.2.3",
        [`${manager}${field}`]: value,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`[${manager}] ${diagnostic}`);
    },
  );

  it.each([
    { version: "2026.6.21-beta.1+build.7", nativeContract: "not-applicable" },
    { version: "1.2.3-beta-rc.1+build.7", nativeContract: "required" },
  ] as const)(
    "emits complete manager-owned identity for $version with the $nativeContract native contract",
    ({ version, nativeContract }) => {
      const { identity, result } = runPackageIdentity({ artifactVersion: version, nativeContract });

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(identity).toMatchObject({
        package: { version },
        containers: expect.arrayContaining([
          expect.objectContaining({
            role: "musl",
            details: expect.objectContaining({
              fsSafeNative: nativeContract === "required" ? "passed" : "not-applicable",
            }),
          }),
          ...[
            ["npm", "/usr/local/lib/node_modules/branch"],
            ["pnpm", "/fake/pnpm/branch"],
            ["bun", "/fake/bun/branch"],
          ].map(([role, installedPackageRoot]) =>
            expect.objectContaining({
              role,
              details: expect.objectContaining({
                installedPackageRoot,
                installedPackageVersion: version,
                parsedBranchVersion: version,
              }),
            }),
          ),
        ]),
      });
    },
  );
});
