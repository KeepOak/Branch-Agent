---
summary: "Host Branch Agent on Upstash Box with keep-alive and SSH tunnel access"
read_when:
  - Deploying Branch Agent to Upstash Box
  - You want a managed Linux environment for Branch Agent with SSH-tunneled dashboard access
title: "Upstash Box"
---

Run a persistent Branch Agent Gateway on Upstash Box, a managed Linux environment
with keep-alive lifecycle support.

Use an SSH tunnel for dashboard access. Do not expose the Gateway port directly
to the public internet.

## Prerequisites

- Upstash account
- Keep-alive Upstash Box
- SSH client on your local machine

## Create a Box

Create a keep-alive Box in the Upstash Console. Note the Box ID (for example
`right-flamingo-14486`) and your Box API key.

Upstash maintains its current Branch Agent Box walkthrough at
[Branch Agent Setup](https://upstash.com/docs/box/guides/branch-setup).

## Connect with an SSH tunnel

Forward the Branch Agent dashboard port to your local machine. Use your Box API key
as the SSH password when prompted:

```bash
ssh -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 <box-id>@us-east-1.box.upstash.com
```

The keepalive options reduce idle tunnel drops during onboarding.

## Install Branch Agent

Check the Box's runtime versions first, because the install command depends on
the npm version:

```bash
node -v
npm -v
```

Inside the Box, use the following command on npm 12 or npm 11.16+. On npm 11.15
and earlier, omit `--allow-scripts=branch`.

```bash
sudo npm install -g branch --allow-scripts=branch
```

## Run onboarding

```bash
branch onboard --no-install-daemon
```

Follow the prompts. Copy the dashboard URL and token when onboarding finishes.

## Start the Gateway

Keep the Gateway on loopback for the SSH tunnel, then start one unsupervised
process in the background:

```bash
branch config set gateway.bind loopback
nohup branch gateway run > gateway.log 2>&1 &
branch doctor --json
```

With the SSH tunnel active, open the dashboard URL locally:

```text
http://127.0.0.1:18789/#token=<your-token>
```

## Auto-restart

Set this command as the Box init script so the Gateway restarts when the Box
starts:

```bash
nohup branch gateway run > gateway.log 2>&1 &
```

Onboarding deliberately skips daemon installation in this guide. The Box init
script is the single owner of Gateway startup, so two processes do not contend
for the same lock and port.

## Troubleshooting

If SSH freezes during onboarding, reconnect with a clean SSH config and
keepalives:

```bash
ssh -F /dev/null -o ControlMaster=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 18789:127.0.0.1:18789 <box-id>@us-east-1.box.upstash.com
```

This bypasses stale local `~/.ssh/config` settings and keeps the tunnel active
through idle network periods.

## Next steps

- Set up messaging channels: [Channels](/channels)
- Configure the Gateway: [Gateway configuration](/gateway/configuration)
- Keep Branch Agent up to date: [Updating](/install/updating)
- Compare hosting options: [Linux server](/vps)

## Related

- [Remote access](/gateway/remote)
- [Gateway security](/gateway/security)
- [Updating Branch Agent](/install/updating)
