---
summary: "Data locations, AGENTS.md and SOUL.md placement, backups, and uninstalling"
title: "Where things live on disk"
read_when:
  - You need to find, back up, or move Branch Agent data
  - You are deciding where agent instruction files belong
---

## Where things live on disk

<AccordionGroup>
  <Accordion title="Is all data used with Branch Agent saved locally?">
    No: **Branch Agent's own state is local**, but **external services still see what you send them**.

    - **Local by default**: sessions, memory files, config, and workspace live on the Gateway host (`~/.branch` plus your workspace directory).
    - **Remote by necessity**: messages sent to model providers (Anthropic/OpenAI/etc.) go to their APIs, and chat platforms (Slack/Telegram/WhatsApp/etc.) store message data on their servers.
    - **You control the footprint**: local models keep prompts on your machine, but channel traffic still goes through the channel's servers.

    Related: [Agent workspace](/concepts/agent-workspace), [Memory](/concepts/memory).

  </Accordion>

  <Accordion title="Where does Branch Agent store its data?">
    Everything lives under `$BRANCH_STATE_DIR` (default: `~/.branch`):

    | Path                                                               | Purpose                                                            |
    | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
    | `$BRANCH_STATE_DIR/branch.json`                                 | Main config (JSON5)                                                 |
    | `$BRANCH_STATE_DIR/credentials/oauth.json`                        | Legacy OAuth migration source for `branch doctor --fix`           |
    | `$BRANCH_STATE_DIR/state/branch.sqlite`                         | Shared SQLite state, including shared auth profiles                 |
    | `$BRANCH_STATE_DIR/secrets.json`                                  | Optional file-backed secret payload for `file` SecretRef providers   |
    | `$BRANCH_STATE_DIR/agents/<agentId>/agent/auth.json`              | Legacy auth migration source for `branch doctor --fix`             |
    | `$BRANCH_STATE_DIR/credentials/`                                  | Provider state (for example `whatsapp/<accountId>/creds.json`)      |
    | `$BRANCH_STATE_DIR/agents/`                                       | Per-agent state (agentDir + legacy/archive session artifacts)        |
    | `$BRANCH_STATE_DIR/agents/<agentId>/agent/branch-agent.sqlite`  | Per-agent SQLite state, including local auth profiles, sessions, and transcripts |
    | `$BRANCH_STATE_DIR/agents/<agentId>/sessions/`                    | Legacy session migration sources and archive/support artifacts      |

    Legacy single-agent path `~/.branch/agent/*` is migrated by `branch doctor`.

    Legacy `auth-profiles.json` files are imported by `branch doctor --fix`;
    new logins write SQLite. Agent-local profiles override the shared read-through
    base. Older installs keep that shared store in the main agent's database until
    doctor relocates it; see [Auth credential semantics](/auth-credential-semantics#agent-copy-portability).

    Your **workspace** (AGENTS.md, memory files, skills, etc.) is separate, configured via `agents.defaults.workspace` (default: `~/.branch/workspace`).

  </Accordion>

  <Accordion title="Where should AGENTS.md / SOUL.md / USER.md / MEMORY.md live?">
    These live in the **agent workspace**, not `~/.branch`.

    - **Workspace (per agent)**: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`. Lowercase root `memory.md` is legacy repair input only; `branch doctor --fix` can merge it into `MEMORY.md` when both exist.
    - **State dir (`~/.branch`)**: config, channel/provider state, auth profiles, sessions, logs, shared skills (`~/.branch/skills`).

    Default workspace is `~/.branch/workspace`, configurable:

    ```json5
    {
      agents: { defaults: { workspace: "~/.branch/workspace" } },
    }
    ```

    If the bot "forgets" after a restart, confirm the Gateway uses the same workspace on every launch (remote mode uses the **gateway host's** workspace, not your local laptop).

    Tip: for durable behavior or preference, ask the bot to **write it into AGENTS.md or MEMORY.md** rather than relying on chat history.

    See [Agent workspace](/concepts/agent-workspace) and [Memory](/concepts/memory).

  </Accordion>

  <Accordion title="Can I make SOUL.md bigger?">
    Yes. `SOUL.md` is one of the workspace bootstrap files injected into agent context. Default per-file injection limit is `20000` characters; total bootstrap budget across files is `60000` characters.

    Change shared defaults:

    ```json5
    {
      agents: {
        defaults: {
          bootstrapMaxChars: 50000,
          bootstrapTotalMaxChars: 300000,
        },
      },
    }
    ```

    Or override one agent under `agents.entries.*.bootstrapMaxChars` / `bootstrapTotalMaxChars`.

    Use `/context` to check raw vs injected sizes and whether truncation happened. Keep `SOUL.md` focused on voice, stance, and personality; put operating rules in `AGENTS.md` and durable facts in memory.

    See [Context](/concepts/context) and [Agent config](/gateway/config-agents).

  </Accordion>

  <Accordion title="Recommended backup strategy">
    Put your **agent workspace** in a **private** git repo and back it up somewhere private (for example GitHub private). This captures memory plus AGENTS/SOUL/USER files and lets you restore the assistant's "mind" later.

    Do **not** commit anything under `~/.branch` (credentials, sessions, tokens, encrypted secrets payloads). For a full restore, back up the workspace and state directory separately.

    Docs: [Agent workspace](/concepts/agent-workspace).

  </Accordion>

  <Accordion title="How do I completely uninstall Branch Agent?">
    See [Uninstall](/install/uninstall).
  </Accordion>

  <Accordion title="Can agents work outside the workspace?">
    Yes. The workspace is the **default cwd** and memory anchor, not a hard sandbox. Relative paths resolve inside the workspace; absolute paths can access other host locations unless sandboxing is enabled. For isolation, use [`agents.defaults.sandbox`](/gateway/sandboxing) or per-agent sandbox settings. To make a repo the default working directory, point that agent's `workspace` at the repo root - the Branch Agent repo itself is just source code, so keep the workspace separate unless you intentionally want the agent to work inside it.

    ```json5
    {
      agents: {
        defaults: {
          workspace: "~/path/to/my-repo",
        },
      },
    }
    ```

  </Accordion>

  <Accordion title="Remote mode: where is the session store?">
    Session state is owned by the **gateway host**. In remote mode, the session store you care about is on the remote machine, not your local laptop. See [Session management](/concepts/session).
  </Accordion>
</AccordionGroup>
