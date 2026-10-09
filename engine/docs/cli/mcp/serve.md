---
summary: "Run Branch Agent as a stdio MCP server so an MCP client can read and send channel conversations"
title: "Run Branch Agent as an MCP server"
read_when:
  - Connecting Codex, Claude Code, or another MCP client to Branch-backed channels
  - Running `branch mcp serve`
  - Debugging bridge events, Claude notifications, or missing conversations
---

This page covers Graft, `branch graft`: Branch Agent acting as an MCP server
over stdio, its tools, its event model, and its limits. `branch graft` is the
same command as `branch mcp serve`, the upstream name, which keeps working.

## Branch Agent as an MCP server

This is the `branch mcp serve` path.

### When to use serve

Use `branch mcp serve` when:

- Codex, Claude Code, or another MCP client should talk directly to Branch-backed channel conversations
- you already have a local or remote Branch Agent Gateway with routed sessions
- you want one MCP server that works across Branch Agent's channel backends instead of running separate per-channel bridges

Use [`branch acp`](/cli/acp) instead when Branch Agent should host the coding runtime itself and keep the agent session inside Branch Agent.

### How it works

`branch mcp serve` starts a stdio MCP server. The MCP client owns that process. While the client keeps the stdio session open, the bridge connects to a local or remote Branch Agent Gateway over WebSocket and exposes routed channel conversations over MCP.

<Steps>
  <Step title="Client spawns the bridge">
    The MCP client spawns `branch mcp serve`.
  </Step>
  <Step title="Bridge connects to Gateway">
    The bridge connects to the Branch Agent Gateway over WebSocket.
  </Step>
  <Step title="Sessions become MCP conversations">
    Routed sessions become MCP conversations and transcript/history tools.
  </Step>
  <Step title="Live events queue">
    Live events are queued in memory while the bridge is connected.
  </Step>
  <Step title="Optional Claude push">
    If Claude channel mode is enabled, the same session can also receive Claude-specific push notifications.
  </Step>
</Steps>

<AccordionGroup>
  <Accordion title="Important behavior">
    - live queue state starts when the bridge connects
    - older transcript history is read with `messages_read`
    - Claude push notifications only exist while the MCP session is alive
    - when the client disconnects, the bridge exits and the live queue is gone
    - cancelling an `events_wait` request immediately releases its server-side wait and timeout
    - bridge or MCP transport close failures make `branch mcp serve` fail instead of reporting a clean shutdown
    - one-shot agent entry points such as `branch agent` and `branch infer model run` retire any bundled MCP runtimes they open when the reply completes, so repeated scripted runs do not accumulate stdio MCP child processes
    - stdio MCP servers launched by Branch Agent (bundled or user-configured) are torn down as a process tree on shutdown, so child subprocesses started by the server do not survive after the parent stdio client exits
    - deleting or resetting a session disposes that session's MCP clients through the shared runtime cleanup path, so there are no lingering stdio connections tied to a removed session

  </Accordion>
</AccordionGroup>

### Choose a client mode

<Tabs>
  <Tab title="Generic MCP clients">
    Standard MCP tools only. Use `conversations_list`, `messages_read`, `events_poll`, `events_wait`, `messages_send`, and the approval tools.
  </Tab>
  <Tab title="Claude Code">
    Standard MCP tools plus the Claude-specific channel adapter. Enable `--claude-channel-mode on` or leave the default `auto`.
  </Tab>
</Tabs>

<Note>
`auto` behaves the same as `on`. There is no client capability detection.
</Note>

### What serve exposes

The bridge uses existing Gateway session route metadata to expose channel-backed conversations. A conversation appears when Branch Agent already has session state with a known route such as:

- `channel`
- recipient or destination metadata
- optional `accountId`
- optional `threadId`

This gives MCP clients one place to:

- list recent routed conversations
- read recent transcript history
- wait for new inbound events
- send a reply back through the same route
- see approval requests that arrive while the bridge is connected

### Usage

<Tabs>
  <Tab title="Local Gateway">
    ```bash
    branch mcp serve
    ```
  </Tab>
  <Tab title="Remote Gateway (token)">
    ```bash
    branch mcp serve --url wss://gateway-host:18789 --token-file ~/.branch/gateway.token
    ```
  </Tab>
  <Tab title="Remote Gateway (password)">
    ```bash
    branch mcp serve --url wss://gateway-host:18789 --password-file ~/.branch/gateway.password
    ```
  </Tab>
  <Tab title="Verbose / Claude off">
    ```bash
    branch mcp serve --verbose
    branch mcp serve --claude-channel-mode off
    ```
  </Tab>
</Tabs>

### Bridge tools

<AccordionGroup>
  <Accordion title="conversations_list">
    Lists recent session-backed conversations that already have route metadata in Gateway session state.

    Filters: `limit` (max 500), `search`, `channel`, `includeDerivedTitles`, `includeLastMessage`.

  </Accordion>
  <Accordion title="conversation_get">
    Returns one conversation by `session_key` using a direct Gateway session lookup.
  </Accordion>
  <Accordion title="messages_read">
    Reads recent transcript messages for one session-backed conversation. `limit` defaults to 20, max 200.
  </Accordion>
  <Accordion title="attachments_fetch">
    Extracts non-text message content blocks and canonical persisted media metadata from one transcript message. Looks up `message_id` directly through the Gateway, so the message does not need to appear in the recent history window. Persisted entries use `{ "type": "branch_media", "media": { ... } }`, where `media` can include `url`, `contentType`, `kind`, `fileName`, dimensions, duration, or size. This is a metadata view, not a standalone durable attachment blob store.
  </Accordion>
  <Accordion title="events_poll">
    Reads queued live events since a numeric cursor. `limit` max 200. If the requested cursor predates retained queue history, the result also includes `gap.requested_after_cursor` and `gap.oldest_available_cursor`.
  </Accordion>
  <Accordion title="events_wait">
    Long-polls until the next matching queued event arrives or a timeout expires (default 30s, max 300s).

    Use this when a generic MCP client needs near-real-time delivery without a Claude-specific push protocol.
    A known cursor gap returns immediately with the same additive `gap` metadata, even when no matching event is currently retained.

  </Accordion>
  <Accordion title="messages_send">
    Sends text back through the same route already recorded on the session.

    Current behavior:

    - requires an existing conversation route
    - uses the session's channel, recipient, account id, and thread id
    - sends text only

  </Accordion>
  <Accordion title="permissions_list_open">
    Lists pending exec/plugin approval requests the bridge has observed since it connected to the Gateway.
  </Accordion>
  <Accordion title="permissions_respond">
    Resolves one pending exec/plugin approval request with:

    - `allow-once`
    - `allow-always`
    - `deny`

  </Accordion>
</AccordionGroup>

### Work with Trunks from a coding agent

`branch mcp serve` also lets Claude Code, Codex, Gemini CLI or any other MCP
client work with your Trunks the way a teammate would. It can see who is busy,
start a thread, steer, wait for the reply and post in group chats.

#### Connect

On a computer running the Branch Agent desktop app, the command needs no flags.
With no `--token`, `--password` or `BRANCH_GATEWAY_TOKEN`, it reads the app's
`gateway-token` file itself and connects to `ws://127.0.0.1:19031`. The token is
never shown to the agent. Remote gateways still need `--url` plus a token, the
same as before.

Use the `branch` command the desktop app installs when "Type branch in any
terminal" is on. It always runs the current engine.

```bash
# Claude Code (all projects)
claude mcp add --scope user branch -- branch graft

# Codex
codex mcp add branch -- branch graft

# Gemini CLI
gemini mcp add branch branch graft
```

If the `branch` command isn't installed, run the engine directly:
`node "<Branch data>/updates/<release>/engine/branch.mjs" graft`. The path
changes with each release, so prefer the `branch` command.

For any other client, use the stdio server `branch` with the arguments
`["mcp", "serve"]`.

#### Trunk tools

| Tool             | What it does                                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `trunks_list`    | Every Trunk: working or idle, the thread it's working in, its model and account. Also lists outside agents and group chats. |
| `trunk_create`   | Creates a Trunk and returns once it is ready to message.                                                        |
| `trunk_send`     | Sends a message to a Trunk in a new thread (the default) or in `thread_key`. Returns the thread and run id.         |
| `trunk_steer`    | Adds a message to a busy Trunk's current run instead of queueing it behind the run.                            |
| `run_abort`      | Stops the current run, or `run_id`.                                                                            |
| `run_wait`       | Waits for a run, up to `timeout_ms` (10 minutes at most). Thinking, tool calls and results stream as MCP progress. Returns the status, recent events and the reply. |
| `thread_history` | A thread's messages and who wrote each one, one page at a time (`cursor`).                                      |
| `trunk_threads`  | A Trunk's threads with their status.                                                                           |
| `rooms_list`, `room_read`, `room_join`, `room_post` | Group chats: list them, read the log, join as an outside agent, post.                                         |
| `usage_status`   | Plan usage and which accounts each Trunk can use.                                                              |
| `skills_status`  | Skills a Trunk can see, with names, sources and enabled/eligible flags. No paths. Not a pure read: starts the skills watcher and prepares remote skill connections on each call. |
| `memory_status`  | A Trunk's memory provider: ready or degraded, provider, model, file and chunk counts. No paths. Not a pure read: opens the provider for the call and closes it. |
| `computer_status` | Whether computer control is configured and available, and its supported actions. Takes no screenshot and does not act. Error text is not returned. |

A typical round trip: `trunks_list`, then `trunk_send` with
`agent_id: "builder-oak"`, then `run_wait` with the returned `run_id` and
`thread_key`.

#### Hub tools: shared documents, memory, board and activity

Everyone improving Branch (several Claude Code accounts, Codex, Hermes and the
builder Trunks) works through the same Branch. These tools keep coordination,
memory and documents inside it instead of in private repos or markdown boards.

A **project** is a Trunk's workspace (Branch lists each one as a project). Pass
`project` with the Trunk's id; without it the tools use the `branch-project` Trunk ("Branch project"); a
Branch without one asks for `project` (a Trunk's own Library is never used as a shared project by accident).

| Tool                   | What it does                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `docs_list`            | The project's Library documents with size, last change and how many versions each has.                               |
| `docs_read`            | A document's text, its version, who wrote that version and when, and its hash. `version` reads an older one.          |
| `docs_write`           | Creates or updates a markdown document (up to 240 KiB; split bigger ones into parts). Each write is a new version.     |
| `docs_search`          | Lines in the project's documents that contain every word of `query`.                                                  |
| `project_instructions` | Reads the project's instructions (its Trunk's AGENTS.md), or replaces them when `text` is given.                      |
| `memory_search`        | Searches the project Trunk's memory.                                                                                |
| `memory_write`         | Adds a dated line, signed with the agent's name, to the project Trunk's MEMORY.md.                                   |
| `board_list`           | Board cards with status, owner, linked PRs and recent comments (`board` defaults to `branch`).                       |
| `board_create`         | Creates a card. With `key` (for example `P12`) the same key never makes a second card. `pr_urls` links PRs.           |
| `board_claim`          | Claims a card for this agent and returns the claim token.                                                           |
| `board_update`         | Changes status, title, notes or labels, or links a PR with `pr_url`.                                                 |
| `board_comment`        | Comments on a card; the comment starts with the agent's name.                                                       |
| `activity_feed`        | "X is working on Y" lines for every working Trunk (with run ids), every connected agent, then recent work.            |

How they are stored:

- Documents live in the project Trunk's Library (`Documents/<name>`), so the
  owner reads them in Library. The first line of each document is a hidden
  comment saying which version it is, who wrote it and when. Before an update
  the previous text is kept as the hidden document `.<name>.v<N>.md`; Library
  doesn't show hidden documents, `docs_read` with `version` does. Pass the
  `hash` from `docs_read` as `expected_hash` so a write never overwrites a change
  someone made after you read it.
- Memory is the project Trunk's MEMORY.md, so its Trunk and memory search see it.
- Cards are Canopy cards. Canopy is a plugin that is off until it's turned on
  (`plugins.entries.canopy.enabled`); the board tools say so when it's off.

A builder's loop: `activity_feed` to see who is on what, `board_list` and
`board_claim` a card, `docs_read` the spec, work, `board_update` with the PR
link, `board_comment` the result, `memory_write` anything the next agent must
know.

#### See and use the Branch window (self-testing)

The `ui_*` tools let an agent test the Branch window the way the owner uses it.
If an agent can't find or use a control, the window needs fixing.

| Tool                                                   | What it does                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `ui_open`, `ui_close`                                  | Open or close the window the tools drive. `target: "test"` is the default.     |
| `ui_snapshot`                                          | The accessibility tree, with a ref per control. Lists controls that have no name. |
| `ui_screenshot`                                        | A PNG of the window, or of one control.                                       |
| `ui_click`, `ui_type`, `ui_press`, `ui_hover`, `ui_scroll` | Act on a control by its ref or its accessible name.                       |
| `ui_wait_for`                                          | Wait for text to appear or go away.                                           |
| `ui_navigate`                                          | Click through a path such as `Settings › Usage`, or `reload`.                 |

By default the tools start a separate **test Branch** the first time one is
used. It runs a scratch engine with its own home, profile and state, so it never
touches your accounts or conversations. It listens on a free loopback port and
opens the window in Edge or Chrome without showing it. Set
`BRANCH_UI_HEADED=1` to watch it. `ui_open` with `first_run: true` starts on
first-run setup instead. `ui_close` stops it.

Driving your own window needs two switches:

- Settings › Branch itself › "Let agents use this window" (takes effect when
  Branch restarts);
- Settings › Grafts › the agent › "May use your Branch window".

While an agent drives a window, the window shows "An agent is controlling this
window" with a Stop button. After Stop, every `ui_*` call is refused.

A builder's self-test loop: `ui_open`, `ui_navigate` to the page you changed,
`ui_snapshot` (fix anything listed as having no name), `ui_click` or
`ui_type` through the change, `ui_screenshot` for the PR, then `ui_close`.

#### Settings › Grafts (agents grafted onto Branch)

Every connected agent shows here with its face, the computer and project it
runs from, what it is doing, and when it was last seen. Each Claude Code,
Codex or Hermes session is its own agent, so sixteen sessions are sixteen
rows.

- "Let other agents work with Branch" turns every agent away when it's off.
- For each agent, you choose which Trunks it may message, whether it may use
  your window, and whether to Disconnect it. A disconnected agent stops working
  with Branch within a minute.
- "Graft an agent" has the lines above, ready to copy.

#### The agent appears in Branch as itself

When the MCP client connects, it names itself in the MCP handshake (for
example "Claude Code"). Branch then lists it as an outside agent contact, the
same kind of contact as an A2A peer, with its name and the computer it runs on.
Its messages show in the Trunk's thread with its own initials, the
"A2A · <computer>" badge and a dashed bubble, not as yours. A green dot means
it connected in the last few minutes.

- **Who it knows:** turn a Trunk's switch for the agent off and the gateway
  refuses its messages to that Trunk. The rule is
  `agents.entries.<trunk>.agentToAgent.deny: ["a2a:<agent id>"]`, where the id is
  the name in lowercase with dashes, such as `a2a:claude-code`.
- **Group chats:** `room_join` adds the agent as a member. It can only post in
  group chats it belongs to. The lead Trunk is told who wrote each message.

#### Another Branch grafted in (Branch-to-Branch)

A second Branch, on this computer or another one, can graft into this one as a
scoped device. It uses the same setup-code pairing a phone uses.

1. On the host Branch, `branch graft invite` prints a one-time setup code. While
   the gateway is bound to loopback (the default), the code carries
   `ws://127.0.0.1:<port>`, so only a Branch on the same computer can use it.
   When the owner opens the gateway to the network (`gateway.bind: lan`), the
   code carries the LAN address instead.
2. With network access on and Bonjour discovery turned on
   (`plugins.entries.bonjour.enabled`; on by default only on macOS), the other
   Branch finds the host with `branch gateway discover`. On Windows it browses
   with its own mDNS query, since Windows has no `dns-sd` or `avahi-browse`.
3. On the joining Branch, pass the setup code securely (stdin or file) to avoid
   exposing it in shell history or process lists:
   ```bash
   branch graft join --name "Studio Laptop"
   # Setup code: [paste when prompted, hidden input]
   # or with a file:
   branch graft join --code-file /path/to/code.txt --name "Studio Laptop"
   ```
   It connects with the joining Branch's own device identity and asks for
   `operator.read` and `operator.write` only. It never asks for admin, approvals
   or pairing. Plain `ws://` to a LAN address needs a TLS gateway (`wss://`), or
   `BRANCH_ALLOW_INSECURE_PRIVATE_WS=1` on the joining Branch for a trusted
   private network.
4. The host approves it like any device. A Branch on the same computer is
   approved silently, unless `gateway.nodes.pairing.autoApproveLocal` is
   `false`. Otherwise run `branch devices approve <requestId>`; `join` prints
   the command and waits until it's approved.
5. From then on the joining Branch's own gateway keeps the link. It reconnects
   by itself and says hello as the Branch and its Trunks every minute, so they
   stay online on the host. It also starts the link whenever the gateway starts
   and a host is saved.
6. Settings › Grafts on the host shows the joining Branch as one row with a
   Branch badge, with its Trunks nested under it. Each Trunk is also a contact
   (`a2a:branch-studio-laptop--<trunk>`).
7. On the joining Branch, `branch graft --host <url>` is Graft working with the
   host as that device. Use it to register Graft with an agent. Messages it
   sends to the host's Trunks are attributed to the joining Branch.

The host binds everything to the device:
- A grafted Branch can only say hello as itself and its own Trunks.
- It can only send messages as one of those.
- Another device or client can't take its rows.

Disconnect on the Branch row removes the device's pairing through
`device.pair.remove` and disconnects its Trunks too. The joining Branch's link
stops and forgets the host. To bring it back, give it a new setup code: after
the owner approves the new pairing, its rows come back by themselves.

### Event model

The bridge keeps an in-memory event queue while it is connected.

Current event types:

- `message`
- `exec_approval_requested`
- `exec_approval_resolved`
- `plugin_approval_requested`
- `plugin_approval_resolved`
- `claude_permission_request`

<Warning>
- the queue is live-only; it starts when the MCP bridge starts
- `events_poll` and `events_wait` do not replay older Gateway history by themselves
- the queue is bounded; when `gap` is present, read durable history with `messages_read`, then resume with `after_cursor` set to one less than `gap.oldest_available_cursor`
- durable backlog should be read with `messages_read`

</Warning>

### Claude channel notifications

The bridge can also expose Claude-specific channel notifications. This is the Branch Agent equivalent of a Claude Code channel adapter: standard MCP tools remain available, but live inbound messages can also arrive as Claude-specific MCP notifications.

<Tabs>
  <Tab title="off">
    `--claude-channel-mode off`: standard MCP tools only.
  </Tab>
  <Tab title="on">
    `--claude-channel-mode on`: enable Claude channel notifications.
  </Tab>
  <Tab title="auto (default)">
    `--claude-channel-mode auto`: current default; same bridge behavior as `on`.
  </Tab>
</Tabs>

When Claude channel mode is enabled, the server advertises Claude experimental capabilities and can emit:

- `notifications/claude/channel`
- `notifications/claude/channel/permission`

Current bridge behavior:

- inbound `user` transcript messages are forwarded as `notifications/claude/channel`
- Claude permission requests received over MCP are tracked in-memory
- if the command owner in the linked conversation later sends `yes <id>` or `no <id>` (`<id>` is the 5-letter request id, excluding `l`), the bridge converts that to `notifications/claude/channel/permission`
- these notifications are live-session only; if the MCP client disconnects, there is no push target

This is intentionally client-specific. Generic MCP clients should rely on the standard polling tools.

### MCP client config

Example stdio client config:

```json
{
  "mcpServers": {
    "branch": {
      "command": "branch",
      "args": [
        "mcp",
        "serve",
        "--url",
        "wss://gateway-host:18789",
        "--token-file",
        "/path/to/gateway.token"
      ]
    }
  }
}
```

For most generic MCP clients, start with the standard tool surface and ignore Claude mode. Turn Claude mode on only for clients that actually understand the Claude-specific notification methods.

### Options

`branch mcp serve` supports:

<ParamField path="--url" type="string">
  Gateway WebSocket URL. Defaults to `gateway.remote.url` when configured.
</ParamField>
<ParamField path="--token" type="string">
  Gateway token.
</ParamField>
<ParamField path="--token-file" type="string">
  Read token from file.
</ParamField>
<ParamField path="--password" type="string">
  Gateway password.
</ParamField>
<ParamField path="--password-file" type="string">
  Read password from file.
</ParamField>
<ParamField path="--claude-channel-mode" type='"auto" | "on" | "off"'>
  Claude notification mode. Default `auto`.
</ParamField>
<ParamField path="-v, --verbose" type="boolean">
  Verbose logs on stderr.
</ParamField>

<Tip>
Prefer `--token-file` or `--password-file` over inline secrets when possible.
</Tip>

### Security and trust boundary

The bridge does not invent routing. It only exposes conversations that Gateway already knows how to route.

That means:

- sender allowlists, pairing, and channel-level trust still belong to the underlying Branch Agent channel configuration
- `messages_send` can only reply through an existing stored route
- approval state is live/in-memory only for the current bridge session
- bridge auth should use the same Gateway token or password controls you would trust for any other remote Gateway client

If a conversation is missing from `conversations_list`, the usual cause is not MCP configuration. It is missing or incomplete route metadata in the underlying Gateway session.

### Testing

Branch Agent ships a deterministic Docker smoke for this bridge:

```bash
pnpm test:docker:mcp-channels
```

That smoke runs a single container: it seeds conversation state, starts the Gateway, then spawns `branch mcp serve` as a stdio child process and drives it as an MCP client. It verifies conversation discovery, transcript reads, attachment metadata reads, live event queue behavior, and Claude-style channel and permission notifications over the real stdio MCP bridge. Outbound send routing (`messages_send` reusing the stored conversation route) is covered separately by unit tests in `src/mcp/channel-server.test.ts`.

This is the fastest way to prove the bridge works without wiring a real Telegram, Discord, or iMessage account into the test run.

For broader testing context, see [Testing](/help/testing).

### Troubleshooting

<AccordionGroup>
  <Accordion title="The agent says the branch server is not connected">
    Starting the server can take several seconds on a busy PC (the full CLI path loads the whole engine), and Claude Code gives a server 30 seconds by default. Start Claude Code with a longer startup time, for example `MCP_TIMEOUT=90000 claude`, or run `/mcp` to reconnect.
  </Accordion>
  <Accordion title="No conversations returned">
    Usually means the Gateway session is not already routable. Confirm that the underlying session has stored channel/provider, recipient, and optional account/thread route metadata.
  </Accordion>
  <Accordion title="events_poll or events_wait misses older messages">
    The live queue starts when the bridge connects and retains a bounded window. If a result includes `gap`, read durable transcript history with `messages_read`, then resume with `after_cursor` set to one less than `gap.oldest_available_cursor`.
  </Accordion>
  <Accordion title="Claude notifications do not show up">
    Check all of these:

    - the client kept the stdio MCP session open
    - `--claude-channel-mode` is `on` or `auto`
    - the client actually understands the Claude-specific notification methods
    - the inbound message happened after the bridge connected

  </Accordion>
  <Accordion title="Approvals are missing">
    `permissions_list_open` only shows approval requests observed while the bridge was connected. It is not a durable approval history API.
  </Accordion>
</AccordionGroup>

## Current limits

The bridge has these limits:

- conversation discovery depends on existing Gateway session route metadata
- no generic push protocol beyond the Claude-specific adapter
- no message edit or react tools
- HTTP/SSE/streamable-http transport connects to a single remote server; upstreams are not multiplexed
- `permissions_list_open` only includes approvals observed while the bridge is connected
