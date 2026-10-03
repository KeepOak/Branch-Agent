---
summary: "Shared Docker VM runtime steps for long-lived Branch Agent Gateway hosts"
doc-schema-version: 1
read_when:
  - You are deploying Branch Agent on a cloud VM with Docker
  - You need the shared setup, binary bake, persistence, and update flow
title: "Docker VM runtime"
---

Use this runtime flow after provisioning a VM and installing Docker. Provider
guides such as [GCP](/install/gcp) and [Hetzner](/install/hetzner) own VM
creation, firewall rules, SSH access, and the tunnel back to your laptop. This
page owns the Docker setup shared by those hosts.

## Before you begin

You need:

- A Debian or Ubuntu VM with Docker Engine and Docker Compose v2
- At least 6 GB RAM for a source image build; smaller hosts should use the
  official pre-built image below
- The Branch Agent source checkout on the VM
- Provider and model credentials for onboarding
- An SSH-only or otherwise restricted provider firewall; do not expose the
  Gateway port directly to the public Internet

From the VM:

```bash
git clone https://github.com/openclaw/openclaw.git
cd branch
docker --version
docker compose version
```

## Prepare persistent host state

The maintained setup script defaults state to the current VM user's home:

```bash
export BRANCH_CONFIG_DIR="$HOME/.branch"
export BRANCH_WORKSPACE_DIR="$HOME/.branch/workspace"
export BRANCH_AUTH_PROFILE_SECRET_DIR="$HOME/.branch-auth-profile-secrets"
```

Override those paths before setup if your VM uses a dedicated data disk. Keep
all three directories in backups. Current OAuth token material is stored as
plaintext in SQLite under `BRANCH_CONFIG_DIR`, including access, refresh, and
ID-token values. Treat the config directory and its backups or copies as
credentials.

The auth-profile secret directory contains only the local key used to recover
legacy encrypted OAuth sidecar credentials. It must persist for that recovery
path and remain separate from `BRANCH_CONFIG_DIR`, but it does not encrypt
current SQLite rows or protect a state-only backup or copy.

<a id="build-and-launch" />

## Run the maintained Docker setup

```bash
./scripts/docker/setup.sh
```

The script creates the host directories, builds `branch:local`, runs
onboarding, generates a Gateway token, synchronizes `.env`, and starts the
Gateway through the repository's `docker-compose.yml`. The Compose file pins
container-side state to `/home/node/.branch` while using the host paths above
as bind-mount sources.

To use an official prebuilt image instead of building from source:

```bash
export BRANCH_IMAGE="ghcr.io/openclaw/openclaw:latest"
./scripts/docker/setup.sh
```

For unattended setup, provider SecretRefs, extra mounts, sandbox setup, and all
supported environment variables, use the full [Docker guide](/install/docker).

<Warning>
`BRANCH_GATEWAY_BIND=lan` is the normal container setting: `loopback` would
limit the Gateway to the container's own network namespace. Keep the published
host port private with the cloud firewall, then reach it through the SSH tunnel
from the provider guide.
</Warning>

## Bake required binaries into the image

Installing binaries inside a running container is a trap: anything installed
at runtime is lost when the container is recreated. Bake every external binary
a skill needs into the image at build time.

The examples below cover three binaries only, alphabetically:

- `gog` (from `gogcli`) for Gmail access
- `goplaces` for Google Places
- `wacli` for WhatsApp

These are examples, not a complete list. Docker Compose builds the repo-root
`Dockerfile`, so extend that file rather than creating a standalone example or
replacing its contents. The repository Dockerfile has required
manifest extraction, build, production dependency, runtime-assets, and final
runtime stages. Build and production installs share the same manifests and
lockfile, including `packages/*` and selected plugin workspaces.

For Debian packages, prefer the existing build argument:

```bash
export BRANCH_IMAGE_APT_PACKAGES="socat"
```

For downloaded release binaries such as `gog`, `goplaces`, or `wacli`, add the
download and install commands to the repo-root `Dockerfile` final runtime stage,
after its package-install blocks and before `USER node`. Preserve the existing
non-root uid 1000 setup, `tini` entrypoint, health check, and `branch` symlink.

<Note>
The repository Dockerfile digest-pins its Node and Bun base images. Keep those
reviewed pins instead of changing them to floating `FROM node:24-bookworm`
references. For ARM-based VMs, choose `arm64` release assets for extra binaries;
for reproducible builds, use versioned asset URLs and verify their checksums.
</Note>

Rebuild the customized image without repeating onboarding:

```bash
BRANCH_SKIP_ONBOARDING=1 ./scripts/docker/setup.sh
```

If the build fails with `Killed` or exit code 137 during dependency installation
or bundling, the VM is out of memory. Resize it before retrying.

Verify baked binaries:

```bash
docker compose exec branch-gateway which gog
docker compose exec branch-gateway which goplaces
docker compose exec branch-gateway which wacli
```

## Verify and administer the Gateway

```bash
docker compose ps
docker compose logs --tail=100 branch-gateway
curl -fsS http://127.0.0.1:18789/healthz
docker compose run --rm branch-cli dashboard --no-open
```

`/healthz` returning a 200 response confirms that the Gateway process is
listening. The image `HEALTHCHECK` polls the same endpoint. If the Control UI
requires device approval:

```bash
docker compose run --rm branch-cli devices list
docker compose run --rm branch-cli devices approve <requestId>
```

## What persists where

Branch Agent runs in Docker, but the container filesystem is not the source of
truth. Long-lived state must survive restarts, rebuilds, and reboots.

| Component            | Container location                  | Persistence mechanism       | Notes                                                                                      |
| -------------------- | ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| Gateway state/config | `/home/node/.branch/`             | `BRANCH_CONFIG_DIR` mount | Includes `branch.json`, shared state, and installed plugin package roots                 |
| Agent workspace      | `/home/node/.branch/workspace/`   | Workspace mount             | Code and agent artifacts                                                                   |
| Channel credentials  | `/home/node/.branch/credentials/` | Config mount                | Channel credential material                                                                |
| Model auth profiles  | `/home/node/.branch/`             | Config mount                | Shared `state/branch.sqlite`; agent-local `agents/<agentId>/agent/branch-agent.sqlite` |
| Auth-profile key     | `/home/node/.config/branch/`      | Secret-directory mount      | Legacy encrypted-sidecar recovery key; does not protect current SQLite rows                |
| Skill state          | `/home/node/.branch/skills/`      | Config mount                | Skill-level state                                                                          |
| External binaries    | `/usr/local/bin/`                   | Docker image                | Must be baked at build time                                                                |
| Node and OS packages | Container filesystem                | Docker image                | Rebuilt with the image; do not install at runtime                                          |
| Docker container     | Ephemeral                           | Restartable                 | Safe to replace after mounted state is verified                                            |

## Common pitfall: never file-bind `branch.json`

Mount the gateway state **as a directory**, never as a single file. The repo
`docker-compose.yml` already does this:

```yaml
# Supported: whole state directory.
- "${BRANCH_CONFIG_DIR:-${HOME:-/tmp}/.branch}:/home/node/.branch"
```

```yaml
# Unsupported: single-file bind. Do not use this.
# - "./branch.json:/home/node/.branch/branch.json"
```

A single-file bind remains attached to the mounted file. Normal Branch Agent
configuration saves replace `branch.json`. If a host-side save replaces the
source of a single-file bind after the container starts, the container can keep
reading the old file while the host path points to the new one. The host-side
save can succeed without updating what the container sees. An edit that writes
to the same file in place does not cause this divergence.

Fix: keep the directory mount from Compose. Edit `branch.json` on the host
inside that directory.

<a id="updates" />

## Update Branch Agent

For a source-built image:

```bash
git pull --ff-only
BRANCH_SKIP_ONBOARDING=1 ./scripts/docker/setup.sh
docker compose run --rm branch-cli doctor --json
```

For a pinned or prebuilt image, update `BRANCH_IMAGE` to the intended tag or
digest before rerunning the setup script. Routine image upgrades run startup-safe
migrations against the mounted state; see [Upgrading container images](/install/docker#upgrading-container-images)
for recovery when a migration cannot complete automatically.

## Related

- [Docker](/install/docker)
- [Podman](/install/podman)
