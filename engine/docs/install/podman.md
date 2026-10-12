---
summary: "Run Branch Agent in a rootless Podman container"
read_when:
  - You want a containerized gateway with Podman instead of Docker
title: "Podman"
---

Run the Branch Agent Gateway in a rootless Podman container, managed by your current non-root user.

The model:

- Podman runs the gateway container.
- Your host `branch` CLI is the control plane.
- Persistent state lives on the host under `~/.branch` by default.
- Day-to-day management uses `branch --container <name> ...` instead of `sudo -u branch`, `podman exec`, or a separate service user.

## Prerequisites

- **Podman** in rootless mode, with its host init executable (normally `catatonit`) available for the launcher's `--init` flag. On minimal Debian/Ubuntu hosts, install both explicitly: `sudo apt-get install podman catatonit`. For Podman Machine, the helper must be available inside the machine.
- **Branch Agent CLI** installed on the host
- **Optional:** `systemd --user` if you want Quadlet-managed auto-start
- **Optional:** `sudo` only if you want `loginctl enable-linger "$(whoami)"` for boot persistence on a headless host

## Quick start

<Steps>
  <Step title="One-time setup">
    From the repo root, run `./scripts/podman/setup.sh`.

    This builds `branch:local` in your rootless Podman store (or pulls `BRANCH_IMAGE` / `BRANCH_PODMAN_IMAGE` if set), creates `~/.branch/branch.json` with `gateway.mode: "local"` if missing, and creates `~/.branch/.env` with a generated `BRANCH_GATEWAY_TOKEN` if missing.

    Optional build-time env vars:

    | Var | Effect |
    | --- | --- |
    | `BRANCH_IMAGE` / `BRANCH_PODMAN_IMAGE` | Use an existing/pulled image instead of building `branch:local` |
    | `BRANCH_IMAGE_APT_PACKAGES` | Install extra apt packages during image build (also accepts legacy `BRANCH_DOCKER_APT_PACKAGES`) |
    | `BRANCH_IMAGE_PIP_PACKAGES` | Install extra Python packages during image build; pin versions and use only package indexes you trust |
    | `BRANCH_EXTENSIONS` | Compile/package supported selected plugins and install their runtime dependencies |
    | `BRANCH_INSTALL_BROWSER` | Pre-install Chromium and Xvfb for browser automation (set to `1`) |

    For Quadlet-managed setup instead (Linux + systemd user services only):

    ```bash
    ./scripts/podman/setup.sh --quadlet
    ```

    Or set `BRANCH_PODMAN_QUADLET=1`.

  </Step>

  <Step title="Start the Gateway container">
    ```bash
    ./scripts/run-branch-podman.sh launch
    ```

    Starts the container as your current uid/gid with `--userns=keep-id` and bind-mounts your Branch Agent state into the container.

  </Step>

  <Step title="Run onboarding inside the container">
    ```bash
    ./scripts/run-branch-podman.sh launch setup
    ```

    Then open `http://127.0.0.1:18789/` and use the token from `~/.branch/.env`.

    Model auth: use Branch-managed auth during setup (Anthropic API keys, or OpenAI Codex browser OAuth/device-code auth for Codex-backed OpenAI). The Podman launcher does not mount host CLI credential homes such as `~/.claude` or `~/.codex` into the setup or gateway container. Existing host CLI logins are same-host convenience paths only -- for container installs, keep provider auth in the mounted `~/.branch` state that setup manages.

  </Step>

  <Step title="Manage the running container from the host CLI">
    ```bash
    export BRANCH_CONTAINER=branch
    ```

    Then normal `branch` commands run inside that container automatically:

    ```bash
    branch dashboard --no-open
    branch gateway status --deep   # includes extra service scan
    branch doctor
    branch channels login
    ```

    On macOS, Podman machine may make the browser appear non-local to the gateway. If the Control UI reports device-auth errors after launch, use the Tailscale guidance in [Podman and Tailscale](#podman-and-tailscale).

  </Step>
</Steps>

The manual launcher reads only a small allowlist of Podman-related keys from `~/.branch/.env` and passes explicit runtime env vars to the container; it does not hand the full env file to Podman.

## Agent sandbox backend

This page covers running the Gateway itself in a Podman container. Agent sandboxing is separate. Set `agents.defaults.sandbox.backend: "podman"` to select the native Podman CLI directly. The default `"docker"` backend remains Docker-only.

Podman reuses the same `agents.defaults.sandbox.docker.*` container settings as Docker but executes them through the native `podman` CLI. Browser sandboxes remain Docker-only for now.

See [Sandboxing](/gateway/sandboxing#podman-backend) for the config example and image-build command.

## Podman and Tailscale

For HTTPS or remote browser access, follow the main Tailscale docs.

Podman-specific notes:

- Keep the Podman publish host at `127.0.0.1`.
- Prefer host-managed `tailscale serve` over `branch gateway --tailscale serve`.
- On macOS, if local browser device-auth context is unreliable, use Tailscale access instead of ad hoc local tunnel workarounds.

See [Tailscale](/gateway/tailscale) and [Control UI](/web/control-ui).

## Systemd (Quadlet, optional)

If you ran `./scripts/podman/setup.sh --quadlet`, setup installs a Quadlet file at `~/.config/containers/systemd/branch.container`.

| Action | Command                                    |
| ------ | ------------------------------------------ |
| Start  | `systemctl --user start branch.service`  |
| Stop   | `systemctl --user stop branch.service`   |
| Status | `systemctl --user status branch.service` |
| Logs   | `journalctl --user -u branch.service -f` |

After editing the Quadlet file:

```bash
systemctl --user daemon-reload
systemctl --user restart branch.service
```

For boot persistence on SSH/headless hosts, enable lingering for your current user:

```bash
sudo loginctl enable-linger "$(whoami)"
```

The generated Quadlet service keeps a fixed, hardened default shape: `127.0.0.1` published ports (`18789` gateway, `18790` bridge), `--bind lan` inside the container, `keep-id` user namespace, `BRANCH_NO_RESPAWN=1`, `Restart=on-failure`, and `TimeoutStartSec=300`. It reads `~/.branch/.env` as a runtime `EnvironmentFile` for values such as `BRANCH_GATEWAY_TOKEN`, but does not consume the manual launcher's Podman-specific override allowlist. For custom publish ports, publish host, or other container-run flags, use the manual launcher instead, or edit `~/.config/containers/systemd/branch.container` directly and then reload and restart the service.

## Config, env, and storage

- **Config dir:** `~/.branch`
- **Workspace dir:** `~/.branch/workspace`
- **Token file:** `~/.branch/.env`
- **Launch helper:** `./scripts/run-branch-podman.sh`

The launch script and Quadlet bind-mount host state into the container: `BRANCH_CONFIG_DIR` -> `/home/node/.branch`, `BRANCH_WORKSPACE_DIR` -> `/home/node/.branch/workspace`. By default those are host directories, not anonymous container state, so `branch.json`, shared and per-agent SQLite auth stores, channel/provider state, sessions, and workspace survive container replacement. Setup also seeds `gateway.controlUi.allowedOrigins` for `127.0.0.1` and `localhost` on the published gateway port so the local dashboard works with the container's non-loopback bind.

Useful env vars for the manual launcher (persist these in `~/.branch/.env`; the launcher reads that file before finalizing container/image defaults):

| Var                                        | Default          | Effect                                 |
| ------------------------------------------ | ---------------- | -------------------------------------- |
| `BRANCH_PODMAN_CONTAINER`                | `branch`       | Container name                         |
| `BRANCH_PODMAN_IMAGE` / `BRANCH_IMAGE` | `branch:local` | Image to run                           |
| `BRANCH_PODMAN_GATEWAY_HOST_PORT`        | `18789`          | Host port mapped to container `18789`  |
| `BRANCH_PODMAN_BRIDGE_HOST_PORT`         | `18790`          | Host port mapped to container `18790`  |
| `BRANCH_PODMAN_PUBLISH_HOST`             | `127.0.0.1`      | Host interface for published ports     |
| `BRANCH_GATEWAY_BIND`                    | `lan`            | Gateway bind mode inside the container |
| `BRANCH_PODMAN_USERNS`                   | `keep-id`        | `keep-id`, `auto`, or `host`           |

If you use a non-default `BRANCH_CONFIG_DIR` or `BRANCH_WORKSPACE_DIR`, set the same variables for both `./scripts/podman/setup.sh` and later `./scripts/run-branch-podman.sh launch` commands -- the repo-local launcher does not persist custom path overrides across shells.

## Upgrading images

After you rebuild or pull a new image, restart the container or Quadlet service.
On first startup for a new Branch Agent version, the gateway runs safe state and
plugin repairs before reporting ready.

If the gateway exits instead of becoming ready, run the same image once with
`branch doctor --fix` against the same mounted state/config, then restart the
gateway normally:

```bash
BRANCH_CONFIG_DIR="${BRANCH_CONFIG_DIR:-$HOME/.branch}"
BRANCH_WORKSPACE_DIR="${BRANCH_WORKSPACE_DIR:-$BRANCH_CONFIG_DIR/workspace}"
BRANCH_PODMAN_IMAGE="${BRANCH_PODMAN_IMAGE:-${BRANCH_IMAGE:-branch:local}}"

podman run --rm -it \
  --userns=keep-id \
  --user "$(id -u):$(id -g)" \
  -e HOME=/home/node \
  -e NPM_CONFIG_CACHE=/home/node/.branch/.npm \
  -v "$BRANCH_CONFIG_DIR:/home/node/.branch:rw" \
  -v "$BRANCH_WORKSPACE_DIR:/home/node/.branch/workspace:rw" \
  "$BRANCH_PODMAN_IMAGE" \
  branch doctor --fix
```

On SELinux hosts, add `,Z` to both bind mounts if Podman blocks access to the
mounted state.

After restarting the Gateway with the updated image, run the read-only
deployment preflight through the container-aware host CLI:

```bash
export BRANCH_CONTAINER=branch
branch doctor --json
```

## Useful commands

- **Container logs:** `podman logs -f branch`
- **Stop container:** `podman stop branch`
- **Remove container:** `podman rm -f branch`
- **Open dashboard URL from host CLI:** `branch dashboard --no-open`
- **Health/status via host CLI:** `branch gateway status --deep` (RPC probe + extra service scan)

## Troubleshooting

- **Token generation fails:** Setup and launch stop before saving a generated token or starting the container when the selected random source (`openssl`, Python, or `od`) fails. Repair that command and retry.
- **Init executable missing (`lookup init binary` / `container-init binary not found on the host`):** Install `catatonit` on the Podman engine host or repair its configured `init_path`/`helper_binaries_dir` in `containers.conf`, then retry. Installing the helper inside the Gateway or sandbox image does not repair the engine host. Keep `--init` enabled; see [Host init prerequisite](/gateway/sandboxing/podman-backend#host-init-prerequisite).
- **Permission denied (EACCES) on config or workspace:** The container runs with `--userns=keep-id` and `--user <your uid>:<your gid>` by default. Ensure the host config/workspace paths are owned by your current user.
- **Gateway start blocked (missing `gateway.mode=local`):** Ensure `~/.branch/branch.json` exists and sets `gateway.mode="local"`. `scripts/podman/setup.sh` creates this if missing.
- **Container restarts after an image update:** Run the one-off `branch doctor --fix` command in [Upgrading images](#upgrading-images), then start the gateway again.
- **Container CLI commands hit the wrong target:** Use `branch --container <name> ...` explicitly, or export `BRANCH_CONTAINER=<name>` in your shell.
- **`branch update` fails with `--container`:** Expected. Rebuild/pull the image, then restart the container or the Quadlet service.
- **Quadlet service does not start:** Run `systemctl --user daemon-reload`, then `systemctl --user start branch.service`. On headless systems you may also need `sudo loginctl enable-linger "$(whoami)"`.
- **SELinux blocks bind mounts:** Leave the default mount behavior alone; the launcher auto-adds `:Z` on Linux when SELinux is enforcing or permissive.

## Related

- [Docker](/install/docker)
- [Sandboxing](/gateway/sandboxing#podman-backend)
- [Gateway background process](/gateway/background-process)
- [Gateway troubleshooting](/gateway/troubleshooting)
