---
summary: "Run the Branch Agent Gateway on EasyRunner with Podman and Caddy"
read_when:
  - Deploying Branch Agent on EasyRunner
  - Running the Gateway behind EasyRunner's Caddy proxy
  - Choosing persistent volumes and auth for a hosted Gateway
title: "EasyRunner"
---

EasyRunner hosts the Branch Agent Gateway as a small containerized app behind its
Caddy proxy. This guide assumes an EasyRunner host that runs Podman-compatible
Compose apps and terminates HTTPS through Caddy.

## Before you begin

- An EasyRunner server with a domain routed to it.
- The official Branch Agent image (`ghcr.io/openclaw/openclaw`) or your own build.
- A persistent config volume for `/home/node/.branch`.
- A persistent workspace volume for `/home/node/.branch/workspace`.
- A strong Gateway token or password.

Keep device auth enabled when possible. If your reverse proxy cannot carry
device identity correctly, fix trusted-proxy settings first (see
[Trusted proxy auth](/gateway/trusted-proxy-auth)); use dangerous auth
bypasses only on a fully private, operator-controlled network.

## Compose app

Create an EasyRunner app with a Compose file shaped like this:

```yaml
services:
  branch:
    image: ghcr.io/openclaw/openclaw:latest
    restart: unless-stopped
    environment:
      BRANCH_GATEWAY_TOKEN: ${BRANCH_GATEWAY_TOKEN}
      BRANCH_HOME: /home/node
      BRANCH_STATE_DIR: /home/node/.branch
      BRANCH_CONFIG_PATH: /home/node/.branch/branch.json
      BRANCH_WORKSPACE_DIR: /home/node/.branch/workspace
    volumes:
      - branch-config:/home/node/.branch
      - branch-workspace:/home/node/.branch/workspace
    labels:
      caddy: branch.example.com
      caddy.reverse_proxy: "{{upstreams 1455}}"
    command: ["node", "branch.mjs", "gateway", "--bind", "lan", "--port", "1455"]

volumes:
  branch-config:
  branch-workspace:
```

Replace `branch.example.com` with your Gateway hostname. Store
`BRANCH_GATEWAY_TOKEN` in EasyRunner's secret/environment manager instead of
committing it to the app definition. The image binds to loopback by default,
so the explicit `--bind lan --port 1455` in `command` is required for Caddy to
reach the container.

## Configure Branch Agent

Inside the persistent config volume, keep the Gateway reachable only through
the proxy and require auth:

```json5
{
  gateway: {
    bind: "lan",
    port: 1455,
    auth: {
      token: "${BRANCH_GATEWAY_TOKEN}",
    },
  },
}
```

If Caddy terminates TLS for the Gateway, configure trusted-proxy settings for
the exact proxy path rather than disabling auth checks globally. See
[Trusted proxy auth](/gateway/trusted-proxy-auth).

## Verify

From your workstation:

```bash
branch gateway probe --url https://branch.example.com --token <token>
branch gateway status --url https://branch.example.com --token <token>
```

From the EasyRunner host, `GET /healthz` (liveness) and `GET /readyz`
(readiness) need no auth and back the image's built-in container health
check. Also check the app logs for a listening Gateway and no startup
SecretRef, plugin, or channel auth failures.

## Updates and backups

- Pull or build the new Branch Agent image, then redeploy the EasyRunner app.
- Back up the `branch-config` volume before updates. It holds
  `branch.json`, shared auth in `state/branch.sqlite`, agent-local profiles
  in `agents/<agentId>/agent/branch-agent.sqlite`, and installed plugin package state.
- Back up `branch-workspace` if agents write durable project data there.
- Run `branch doctor` after major updates to catch config migrations and
  service warnings.

## Troubleshooting

- `gateway probe` cannot connect: confirm the Caddy hostname points at the app
  and that the container listens on `0.0.0.0:1455`.
- Auth fails: rotate the token in EasyRunner secrets and the local client
  command together.
- Files are root-owned after restore: the image runs as `node` (uid 1000);
  repair the mounted volumes so that user can write
  `/home/node/.branch` and `/home/node/.branch/workspace`.
- Browser or channel plugins fail: check whether the required external
  binaries, network egress, and mounted credentials are available inside the
  container.

## Related

- [Platforms](/platforms) — the VPS and hosting index this page sits under
- [Docker](/install/docker) — the container image and environment variables this Compose file uses
- [Trusted proxy auth](/gateway/trusted-proxy-auth) — the auth mode used behind Caddy
- [Gateway runbook](/gateway) — operating the Gateway once it is up
