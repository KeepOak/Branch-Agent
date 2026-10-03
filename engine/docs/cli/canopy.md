---
summary: "CLI reference for `branch canopy` cards, dispatch, and worker runs"
read_when:
  - You want to inspect or create Canopy cards from the terminal
  - You want to dispatch Canopy worker runs from the CLI
  - You are debugging Canopy CLI or slash command behavior
title: "Canopy CLI"
---

`branch canopy` is the terminal surface for the bundled [Canopy plugin](/plugins/canopy). It lets an operator list cards, create a card, inspect one card, and ask the running Gateway to dispatch ready work into subagent worker runs.

Enable the plugin before using the command:

```bash
branch plugins enable canopy
branch gateway restart
```

## Usage

```bash
branch canopy list [--board <id>] [--status <status>] [--include-archived] [--json]
branch canopy create <title...> [--notes <text>] [--status <status>] [--priority <priority>] [--agent <id>] [--board <id>] [--labels <items>] [--json]
branch canopy show <id> [--json]
branch canopy move <id> --status <status> [--json]
branch canopy dispatch [--board <id>] [--max-starts <count>] [--admin] [--url <url>] [--token <token>] [--timeout <ms>] [--json]
```

The command reads and writes the same plugin-owned SQLite database used by the dashboard and Canopy agent tools. Card ids are UUIDs. Commands that accept a card id also accept an unambiguous id prefix. The compact text output shows the first 8 characters.

Valid `status` values: `triage`, `backlog`, `todo`, `scheduled`, `ready`, `running`, `review`, `blocked`, `done`. Valid `priority` values: `low`, `normal`, `high`, `urgent`.

## `list`

```bash
branch canopy list
branch canopy list --board default --status ready
branch canopy list --json
```

Text output is compact:

```text
7f4a2c10  ready     high    default agent-a  Fix stale worker heartbeat
```

Columns are id prefix, status, priority, board id, optional agent id, and title.

| Flag                 | Purpose                                       |
| -------------------- | --------------------------------------------- |
| `--board <id>`       | Limit results to one board namespace          |
| `--status <status>`  | Limit results to one Canopy status         |
| `--include-archived` | Include archived cards in compact text output |
| `--json`             | Print the full card list as machine JSON      |

Compact text output hides archived cards by default so the CLI matches `/canopy list`. Pass `--include-archived` to show them. JSON output always keeps the full card list, including archived cards, for existing automation.

## `create`

```bash
branch canopy create "Fix stale worker heartbeat" --priority high --labels bug,canopy
branch canopy create "Write Canopy docs" --status ready --agent docs-agent --board docs --notes "Cover CLI, slash command, dispatch, and SQLite state."
```

| Flag                    | Purpose                                 |
| ----------------------- | --------------------------------------- |
| `--notes <text>`        | Initial card notes                      |
| `--status <status>`     | Initial status, default `todo`          |
| `--priority <priority>` | Priority, default `normal`              |
| `--agent <id>`          | Assign the card to an agent or owner id |
| `--board <id>`          | Store the card on a board namespace     |
| `--labels <items>`      | Comma-separated labels                  |
| `--json`                | Print the created card as machine JSON  |

`create` writes directly to Canopy SQLite state. The card is immediately visible in the Control UI Canopy tab and to Canopy tools.

## `show`

```bash
branch canopy show 7f4a2c10
branch canopy show 7f4a2c10 --json
```

Text output prints the compact card line and notes. JSON output returns the full card record, including execution metadata, attempts, comments, links, proof, artifacts, worker logs, protocol state, diagnostics, and automation metadata.

Proof statuses in JSON are worker-reported outcomes. `passed` records the worker's
self-assessment of the attached command or check. It is not an independent verification
result.

## `move`

```bash
branch canopy move 7f4a2c10 --status review
branch canopy move 7f4a2c10 --status done --json
```

`move` changes the card's status using the same manual-operator path as dragging a card in the dashboard. It accepts a full card id or an unambiguous prefix. Active dependency and schedule holds still apply. Operators may move a claimed card without its agent claim token. Claim tokens remain scoped to agent-tool mutations, and JSON output redacts them.

## `dispatch`

```bash
branch canopy dispatch
branch canopy dispatch --json
branch canopy dispatch --max-starts 10
branch canopy dispatch --admin
branch canopy dispatch --url http://127.0.0.1:18789 --token "$BRANCH_GATEWAY_TOKEN"
```

`dispatch` first calls the running Gateway RPC method `canopy.cards.dispatch`. That method uses the same subagent runtime as the dashboard dispatch action. Ready cards therefore become task-tracked worker runs with linked session keys. `--max-starts` uses the additive `canopy.cards.dispatchWithOptions` method, so an older Gateway rejects the option before starting any workers. Restart the Gateway after upgrading, before you use the flag. Cards with an assigned agent use agent-scoped subagent session keys. Unassigned cards keep an unscoped subagent key, so the Gateway's configured default agent is preserved.

The dispatch loop:

1. Promotes dependency-ready children to `ready`.
2. Blocks expired claims or timed-out worker runs.
3. Selects a small batch of unclaimed ready cards.
4. Claims each selected card for the dispatcher or assigned agent.
5. Starts a subagent worker run with bounded card context and the card claim token.
6. Stores the worker run id, session key, execution status, and worker log on the card.

Idle scans leave ready-card history unchanged. Existing dispatch counters and
timestamps remain as historical values; new launches use the card's launch,
attempt, and execution history.

Selection is conservative. One dispatch starts at most three workers by default. It skips archived or already-claimed cards. It starts only one card per owner or agent in a single pass. Cards already owned by active running or review work are left for a later dispatch. Pass `--max-starts <count>` with a positive integer to change the per-pass cap. The one-card-per-owner rule still applies, so the effective number of starts can be lower.

If worker start fails after a card is claimed, Canopy blocks that card and clears the claim. It records the failure in card execution and worker-log metadata. Failed starts stay visible instead of returning the card to the queue silently.

The CLI falls back to data-only dispatch against local Canopy state when both of these are true:

- You give no explicit Gateway target.
- The local Gateway is unavailable, or it does not expose the Canopy dispatch method yet.

Data-only dispatch can still promote dependencies, clean stale claims, and block timed-out runs, but it does not start workers. Auth, permission, and validation failures, and failures for an explicit `--url` or `--token` target, are reported directly instead of triggering the fallback.

Text output reports worker starts:

```text
dispatch complete: started=2 failures=0
```

Fallback output is explicit:

```text
gateway unavailable; data dispatch only: promoted=1 blocked=0
```

JSON output includes the dispatch result. Gateway-backed dispatch can include `started` and `startFailures`. Data-only fallback includes `gatewayUnavailable: true`. Claim tokens are redacted from card JSON output.

In the dashboard, the same dispatch result appears as a short summary. An operator can see how many cards started, promoted, blocked, reclaimed, or failed without opening card details.

## Slash command parity

Command-capable channels can use the matching slash command:

```text
/canopy list
/canopy show 7f4a2c10
/canopy create Fix stale worker heartbeat
/canopy move 7f4a2c10 --status review
/canopy dispatch
```

Slash command dispatch also uses the Gateway subagent runtime. It follows the same claim, worker-start, and failure behavior as the dashboard and CLI Gateway path.

`/canopy list` and `/canopy show` are read commands for authorized command senders. `/canopy create`, `/canopy move`, and `/canopy dispatch` mutate board state and require owner status on chat surfaces or a Gateway client with `operator.write` or `operator.admin`.

## Permissions

The CLI dispatch path normally requests Gateway `operator.write` and `operator.read` scopes. Workspace-bound cards run directly in an exact configured agent workspace. A worktree request is narrowed to that directory, so the host does not materialize repository-controlled code. The selected worker must have writable, non-shared Docker sandbox access to that exact workspace, a live container hash matching the requested mounts and policy, and no host escape capability. Pass `--admin` to explicitly request `operator.admin`, allow another host checkout, and use normal managed-worktree setup. The connection fails if that scope is not approved for the client. A read-only Gateway token can inspect Canopy data through read methods, but it cannot create cards or dispatch workers. Workspace limits do not otherwise change manual card movement for callers with Canopy mutation permission.

Local `list`, `create`, `show`, and `move` commands operate on the local Branch Agent state directory used by the current profile. Use `--dev` or `--profile <name>` on the top-level `branch` command when you need a different state root.

## Troubleshooting

### No cards appear

Check that the plugin is enabled for the same profile and state root:

```bash
branch plugins inspect canopy --runtime --json
```

If the dashboard shows cards but the CLI does not, check that both commands use the same `--dev` or `--profile` setting.

### Dispatch says data-only

Start or restart the Gateway:

```bash
branch gateway restart
branch gateway status --deep
```

Then retry `branch canopy dispatch`. Data-only fallback is useful for local state cleanup, but worker runs need a live Gateway.

### Dispatch starts nothing

Check for at least one `ready` card without an active claim:

```bash
branch canopy list --status ready
```

Cards can also be skipped when the same owner already has running or review work. Move completed work to `done`, release stale claims through the Canopy tools, or run dispatch again after the active worker finishes.

## Related

- [Canopy plugin](/plugins/canopy)
- [CLI reference](/cli)
- [Slash commands](/tools/slash-commands)
- [Control UI](/web/control-ui)
