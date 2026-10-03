---
summary: "CLI reference for `branch dns` (wide-area discovery helpers)"
read_when:
  - You want wide-area discovery (DNS-SD) via Tailscale + CoreDNS
  - You're setting up split DNS for a custom discovery domain (example: branch.internal)
title: "DNS"
---

# `branch dns`

DNS helpers for wide-area discovery (Tailscale + CoreDNS). `branch dns setup` prints its plan on any platform; applying that plan with `--apply` requires macOS with Homebrew CoreDNS.

Related:

- Gateway discovery: [Discovery](/gateway/discovery)
- Wide-area publishing behavior: [Bonjour discovery](/gateway/bonjour)
- Wide-area discovery config: [`discovery.wideArea`](/gateway/config-runtime#wide-area-dns-sd)

## `dns setup`

Plan or apply CoreDNS setup for unicast DNS-SD discovery.

```bash
branch dns setup
branch dns setup --domain branch.internal
branch dns setup --apply
```

| Option              | Effect                                                                              |
| ------------------- | ----------------------------------------------------------------------------------- |
| `--domain <domain>` | Wide-area discovery domain (for example `branch.internal`).                       |
| `--apply`           | Install/update CoreDNS config and (re)start the service. Requires sudo, macOS only. |

Without `--domain`, Branch Agent uses `discovery.wideArea.domain` from config. Setting that domain enables wide-area discovery.

Without `--apply`, the command only prints:

- Resolved discovery domain and zone file path
- Current tailnet IPs
- Recommended `branch.json` discovery config
- Tailscale Split DNS nameserver/domain values to set in the Tailscale admin console

With `--apply` (macOS only, requires Homebrew CoreDNS):

- Bootstraps the zone file if missing
- Adds the CoreDNS import stanza if missing
- Restarts the `coredns` brew service

## Related

- [CLI reference](/cli)
- [Discovery](/gateway/discovery)
