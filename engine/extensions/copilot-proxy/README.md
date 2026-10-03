# Copilot Proxy (Branch Agent plugin)

Provider plugin for the **Copilot Proxy** VS Code extension.

## Enable

This bundled plugin is enabled by default. If you previously disabled it, re-enable it:

```bash
branch plugins enable copilot-proxy
```

Restart the Gateway after enabling.

## Authenticate

```bash
branch models auth login --provider copilot-proxy --set-default
```

## Notes

- Copilot Proxy must be running in VS Code.
- Base URL must include `/v1`.
