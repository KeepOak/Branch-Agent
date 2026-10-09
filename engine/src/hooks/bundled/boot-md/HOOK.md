---
name: boot-md
description: "Run BOOT.md on gateway startup"
homepage: https://github.com/KeepOak/Branch-Agent/tree/main/engine/docs/automation/hooks#boot-md
metadata:
  {
    "branch":
      {
        "emoji": "🚀",
        "events": ["gateway:startup"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Branch Agent" }],
      },
  }
---

# Boot Checklist Hook

Runs `BOOT.md` at Gateway startup once per distinct configured agent workspace,
if the file exists there. Agents sharing a workspace do not run the same checklist
again. Enable with `branch hooks enable boot-md`, then restart the Gateway.
