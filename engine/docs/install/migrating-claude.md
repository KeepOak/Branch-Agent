---
summary: "Move Claude Code and Claude Desktop local state into Branch Agent with a previewed import"
read_when:
  - You are coming from Claude Code or Claude Desktop and want to keep instructions, MCP servers, and skills
  - You need to understand what Branch Agent imports automatically and what stays archive-only
title: "Migrating from Claude"
---

Branch Agent imports local Claude state through the bundled Claude migration provider. The provider previews every item before changing state and redacts secrets in plans and reports. Standalone `branch migrate` creates a verified backup; the fresh onboarding path stages the import and publishes it only after verification succeeds.

<Note>
Onboarding imports require a fresh Branch Agent setup. If you already have local Branch Agent state, reset config, credentials, sessions, and the workspace first, or use `branch migrate` directly with `--overwrite` after reviewing the plan.
</Note>

## Two ways to import

<Tabs>
  <Tab title="Onboarding wizard">
    The wizard offers Claude when it detects local Claude state.

    ```bash
    branch onboard --flow import
    ```

    Or point at a specific source:

    ```bash
    branch onboard --import-from claude --import-source ~/.claude
    ```

  </Tab>
  <Tab title="CLI">
    Use `branch migrate` for scripted or repeatable runs. See [`branch migrate`](/cli/migrate) for the full reference.

    ```bash
    branch migrate claude --dry-run
    branch migrate apply claude --yes
    ```

    Add `--from <path>` to import a specific Claude Code home or project root.

  </Tab>
</Tabs>

## What gets imported

<AccordionGroup>
  <Accordion title="Instructions and memory">
    - Project `CLAUDE.md` and `.claude/CLAUDE.md` content is copied or appended into the Branch Agent agent workspace `AGENTS.md`.
    - User `~/.claude/CLAUDE.md` content is appended into workspace `USER.md`.

  </Accordion>
  <Accordion title="MCP servers">
    MCP server definitions are imported from project `.mcp.json`, Claude Code `~/.claude.json`, and Claude Desktop `claude_desktop_config.json` when present.
  </Accordion>
  <Accordion title="Skills and commands">
    - Claude skills with a `SKILL.md` file are copied into the Branch Agent workspace skills directory.
    - Claude command Markdown files under `.claude/commands/` or `~/.claude/commands/` are converted into Branch Agent skills with `disable-model-invocation: true`.

  </Accordion>
</AccordionGroup>

## What stays archive-only

The provider copies these into the migration report for manual review, but does **not** load them into live Branch Agent config:

- Claude hooks
- Claude permissions and broad tool allowlists
- Claude environment defaults
- `CLAUDE.local.md`
- `.claude/rules/`
- Claude subagents under `.claude/agents/` or `~/.claude/agents/`
- Claude Code caches, plans, and project history directories
- Claude Desktop extensions and OS-stored credentials

Branch Agent refuses to execute hooks, trust permission allowlists, or decode opaque OAuth and Desktop credential state automatically. Move what you need by hand after reviewing the archive.

## Source selection

Without `--from`, Branch Agent inspects the default Claude Code home at `~/.claude`, the sampled Claude Code `~/.claude.json` state file, and the Claude Desktop MCP config on macOS.

When `--from` points at a project root, Branch Agent imports only that project's Claude files, such as `CLAUDE.md`, `.claude/settings.json`, `.claude/commands/`, `.claude/skills/`, and `.mcp.json`. It does not read your global Claude home during a project-root import.

## Recommended flow

<Steps>
  <Step title="Preview the plan">
    ```bash
    branch migrate claude --dry-run
    ```

    The plan lists everything that will change, including conflicts, skipped items, and sensitive values redacted from nested MCP `env` or `headers` fields.

  </Step>
  <Step title="Apply with backup">
    ```bash
    branch migrate apply claude --yes
    ```

    Branch Agent creates and verifies a backup before applying.

  </Step>
  <Step title="Run doctor">
    ```bash
    branch doctor
    ```

    [Doctor](/gateway/doctor) checks for config or state issues after the import.

  </Step>
  <Step title="Restart and verify">
    ```bash
    branch gateway restart
    branch status
    ```

    Confirm the gateway is healthy and your imported instructions, MCP servers, and skills are loaded.

  </Step>
</Steps>

## Conflict handling

Apply refuses to continue when the plan reports conflicts (a file or config value already exists at the target).

<Warning>
Rerun with `--overwrite` only when replacing the existing target is intentional.
</Warning>

Before overwriting a skill generated from a Claude command, Branch Agent backs up its whole directory and records the path in the item's `details.backupPath` in `report.json`. That path remains available if the overwrite fails. If the command source cannot be read, migration reports an error without changing the existing skill.

For a fresh Branch Agent install, conflicts are unusual. They typically appear when you re-run the import on a setup that already has user edits.

## JSON output for automation

```bash
branch migrate claude --dry-run --json
branch migrate apply claude --json --yes
```

`--yes` is required for `migrate apply` outside an interactive terminal; without it Branch Agent errors instead of applying, so scripts and CI must pass `--yes` explicitly. Preview first with `--dry-run --json`, then apply with `--json --yes` once the plan looks right.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Claude state lives outside ~/.claude">
    Pass `--from /actual/path` (CLI) or `--import-source /actual/path` (onboarding).
  </Accordion>
  <Accordion title="Onboarding refuses to import on an existing setup">
    Onboarding imports require a fresh setup. Either reset state and re-onboard, or use `branch migrate apply claude` directly, which supports `--overwrite` and explicit backup control.
  </Accordion>
  <Accordion title="MCP servers from Claude Desktop did not import">
    Claude Desktop reads `claude_desktop_config.json` from a platform-specific path. Point `--from` at that file's directory if Branch Agent did not detect it automatically.
  </Accordion>
  <Accordion title="Claude commands became skills with model invocation disabled">
    By design. Claude commands are user-triggered, so Branch Agent imports them as skills with `disable-model-invocation: true`. Edit each skill's frontmatter if you want the agent to invoke them automatically.
  </Accordion>
</AccordionGroup>

## Related

- [`branch migrate`](/cli/migrate): full CLI reference, plugin contract, and JSON shapes.
- [Migration guide](/install/migrating): all migration paths.
- [Migrating from Hermes](/install/migrating-hermes): the other cross-system import path.
- [Onboarding](/cli/onboard): wizard flow and non-interactive flags.
- [Doctor](/gateway/doctor): post-migration health check.
- [Agent workspace](/concepts/agent-workspace): where `AGENTS.md`, `USER.md`, and skills live.
