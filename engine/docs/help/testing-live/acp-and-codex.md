---
summary: "The live ACP conversation-bind smoke and the plugin-owned Codex app-server harness smoke"
title: "ACP bind and Codex app-server lanes"
read_when:
  - You are debugging `/acp spawn ... --bind here` against a real ACP agent
  - You are running the Codex app-server harness, its stress probes, or its Docker recipe
---

## Live: ACP bind smoke (`/acp spawn ... --bind here`)

- Test: `src/gateway/gateway-acp-bind.live.test.ts`
- Goal: validate the real ACP conversation-bind flow with a live ACP agent:
  - send `/acp spawn <agent> --bind here`
  - bind a synthetic message-channel conversation in place
  - send a normal follow-up on that same conversation
  - verify the follow-up lands in the bound ACP session transcript
- Enable:
  - `pnpm test:live src/gateway/gateway-acp-bind.live.test.ts`
  - `BRANCH_LIVE_ACP_BIND=1`
- Defaults:
  - ACP agents in Docker: `claude,codex,gemini`
  - ACP agent for direct `pnpm test:live ...`: `claude`
  - Synthetic channel: Slack DM-style conversation context
  - ACP backend: `acpx`
- Overrides:
  - `BRANCH_LIVE_ACP_BIND_AGENT=claude`
  - `BRANCH_LIVE_ACP_BIND_AGENT=codex`
  - `BRANCH_LIVE_ACP_BIND_AGENT=droid`
  - `BRANCH_LIVE_ACP_BIND_AGENT=gemini`
  - `BRANCH_LIVE_ACP_BIND_AGENT=opencode`
  - `BRANCH_LIVE_ACP_BIND_AGENTS=claude,codex,gemini`
  - `BRANCH_LIVE_ACP_BIND_AGENT_COMMAND='npx -y @agentclientprotocol/claude-agent-acp@<version>'`
  - `BRANCH_LIVE_ACP_BIND_CODEX_MODEL=gpt-5.6-luna`
  - `BRANCH_LIVE_ACP_BIND_OPENCODE_MODEL=opencode/kimi-k2.6`
  - `BRANCH_LIVE_ACP_BIND_IMAGE_PROBE=1` (or `on`/`true`/`yes`) to force the image probe on; any other value forces it off. Runs by default for every agent except `opencode`.
  - `BRANCH_LIVE_ACP_BIND_REQUIRE_CRON=1`
  - `BRANCH_LIVE_ACP_BIND_PARENT_MODEL=openai/gpt-5.6-luna`
- Notes:
  - This lane uses the gateway `chat.send` surface with admin-only synthetic originating-route fields so tests can attach message-channel context without pretending to deliver externally.
  - When `BRANCH_LIVE_ACP_BIND_AGENT_COMMAND` is unset, the test uses the embedded `acpx` plugin's built-in agent registry for the selected ACP harness agent.
  - Bound-session cron MCP creation is best-effort by default because external ACP harnesses can cancel MCP calls after the bind/image proof has passed; set `BRANCH_LIVE_ACP_BIND_REQUIRE_CRON=1` to make that post-bind cron probe strict.

Example:

```bash
BRANCH_LIVE_ACP_BIND=1 \
  BRANCH_LIVE_ACP_BIND_AGENT=claude \
  pnpm test:live src/gateway/gateway-acp-bind.live.test.ts
```

Docker recipe:

```bash
pnpm test:docker:live-acp-bind
```

Single-agent Docker recipes:

```bash
pnpm test:docker:live-acp-bind:claude
pnpm test:docker:live-acp-bind:codex
pnpm test:docker:live-acp-bind:droid
pnpm test:docker:live-acp-bind:gemini
pnpm test:docker:live-acp-bind:opencode
```

Docker notes:

- The Docker runner lives at `scripts/test-live-acp-bind-docker.sh`.
- By default, it runs the ACP bind smoke against the aggregate live CLI agents in sequence: `claude`, `codex`, then `gemini`.
- Use `BRANCH_LIVE_ACP_BIND_AGENTS=claude`, `BRANCH_LIVE_ACP_BIND_AGENTS=codex`, `BRANCH_LIVE_ACP_BIND_AGENTS=droid`, `BRANCH_LIVE_ACP_BIND_AGENTS=gemini`, or `BRANCH_LIVE_ACP_BIND_AGENTS=opencode` to narrow the matrix.
- It stages the matching CLI auth material into the container, then installs the requested live CLI (`@anthropic-ai/claude-code`, `@openai/codex`, Factory Droid via `https://app.factory.ai/cli`, `@google/gemini-cli`, or `opencode-ai`) if missing. The ACP backend itself is the embedded `acpx/runtime` package from the official `acpx` plugin.
- The Droid Docker variant stages `~/.factory` for settings, forwards `FACTORY_API_KEY`, and requires that API key because local Factory OAuth/keyring auth is not portable into the container. It uses ACPX's built-in `droid exec --output-format acp` registry entry.
- The OpenCode Docker variant is a strict single-agent regression lane. It writes a temporary `OPENCODE_CONFIG_CONTENT` default model from `BRANCH_LIVE_ACP_BIND_OPENCODE_MODEL` (default `opencode/kimi-k2.6`).
- Direct `acpx` CLI calls are only a manual/workaround path for comparing behavior outside the Gateway. The Docker ACP bind smoke exercises Branch Agent's embedded `acpx` runtime backend.

## Live: Codex app-server harness smoke

- Goal: validate the plugin-owned Codex harness through the normal gateway
  `agent` method:
  - load the bundled `codex` plugin
  - select an OpenAI model through `/model <ref> --runtime codex`
  - send a first gateway agent turn with the requested thinking level
  - send a second turn to the same Branch Agent session and verify the app-server
    thread can resume
  - run `/codex status` and `/codex models` through the same gateway command
    path
  - optionally run two Guardian-reviewed escalated shell probes: one benign
    command that should be approved and one fake-secret upload that should be
    denied so the agent asks back
- Test: `src/gateway/gateway-codex-harness.live.test.ts`
- Enable: `BRANCH_LIVE_CODEX_HARNESS=1`
- Harness baseline model: `openai/gpt-5.6-luna`
- Fresh OpenAI API-key selection default: `openai/gpt-6-astra`
- Default thinking: `low`
- Model override: `BRANCH_LIVE_CODEX_HARNESS_MODEL=openai/<model>`
- Thinking override: `BRANCH_LIVE_CODEX_HARNESS_THINKING=<level>`
- Non-default model effort assertion:
  `BRANCH_LIVE_CODEX_HARNESS_EXPECTED_EFFORT=<level>`
- Matrix override: `BRANCH_LIVE_CODEX_HARNESS_TARGETS=<model>=<thinking>,...`
- Auth mode: `BRANCH_LIVE_CODEX_HARNESS_AUTH=codex-auth` (default) uses the
  copied Codex login; `api-key` uses `OPENAI_API_KEY` through Codex app-server.
- Optional image probe: `BRANCH_LIVE_CODEX_HARNESS_IMAGE_PROBE=1`
- Optional MCP/tool probe: `BRANCH_LIVE_CODEX_HARNESS_MCP_PROBE=1`
- Optional Guardian probe: `BRANCH_LIVE_CODEX_HARNESS_GUARDIAN_PROBE=1`
- Optional resume stress: `BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS=1` adds
  four history turns, then closes and restarts the Gateway and Codex app-server
  three times while requiring the same native thread id and conversation
  history. Override the bounded counts with
  `BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS` (1-20) and
  `BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS` (1-10).
- Optional fan-out stress: set `BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE=1`
  and `BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT` (1-12). The harness starts
  every child concurrently, waits for every terminal run, and verifies each
  unique child reply and native thread identity.
- Optional compaction stress: `BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS=1`
  generates bounded native tool output, requires automatic compaction events,
  verifies the persisted compaction count and hidden-marker recall, restarts
  the Gateway and physical Codex app-server, then repeats the output and
  compaction wave. Tune the bounded work with
  `BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS` (1-8) and
  `BRANCH_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES` (100000-800000).
- Full direct-API context: `BRANCH_LIVE_CODEX_HARNESS_FULL_CONTEXT=1` applies
  the `922000` context and `700000` total automatic-compaction limits, sends
  dense bounded user turns without `/compact` or another manual checkpoint,
  and requires a later small turn to trigger native automatic compaction. It
  requires
  `BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key` plus an absolute
  `BRANCH_LIVE_CODEX_HARNESS_MODEL_CATALOG` path. The catalog must expose the
  exact selected model with `context_window: 922000`,
  `max_context_window: 922000`, and `auto_compact_token_limit: 700000` so Codex
  does not clamp the override back to its normal catalog window. The ordinary
  reduced-threshold stress above keeps the stricter automatic-compaction and
  hidden-marker retention assertions.
- Optional loop-relay opt-out probe:
  `BRANCH_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY=1`
- The requested thinking preference may map to the nearest effort advertised
  by Codex for that model. For example, Luna maps `minimal` to `low`.
- Known Codex catalog models derive that exact native effort automatically.
  Unknown model overrides must state the expected mapped effort.
- The smoke forces provider/model `agentRuntime.id: "codex"` so a broken Codex
  harness cannot pass by silently falling back to Branch Agent.
- Auth: Codex app-server auth from the local Codex subscription login, or
  `OPENAI_API_KEY` when `BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key`. Docker can
  copy `~/.codex/auth.json` and `~/.codex/config.toml` for subscription runs.

Local recipe:

```bash
BRANCH_LIVE_CODEX_HARNESS=1 \
  BRANCH_LIVE_CODEX_HARNESS_IMAGE_PROBE=1 \
  BRANCH_LIVE_CODEX_HARNESS_MCP_PROBE=1 \
  BRANCH_LIVE_CODEX_HARNESS_GUARDIAN_PROBE=1 \
  BRANCH_LIVE_CODEX_HARNESS_MODEL=openai/gpt-5.6-luna \
  pnpm test:live -- src/gateway/gateway-codex-harness.live.test.ts
```

Docker recipe:

```bash
pnpm test:docker:live-codex-harness
```

Restart and history stress:

```bash
BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS=1 \
pnpm test:docker:live-codex-harness
```

Fan-out, large-output, compaction, and restart stress:

```bash
BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key \
  BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE=1 \
  BRANCH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT=8 \
  BRANCH_LIVE_CODEX_HARNESS_RESUME_STRESS=1 \
  BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS=1 \
  pnpm test:docker:live-codex-harness
```

Full native Codex `922000` input-budget compaction stress:

```bash
BRANCH_LIVE_CODEX_HARNESS=1 \
  BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key \
  BRANCH_LIVE_CODEX_HARNESS_FULL_CONTEXT=1 \
  BRANCH_LIVE_CODEX_HARNESS_MODEL_CATALOG=/absolute/path/to/models-api-1m.json \
  BRANCH_LIVE_CODEX_HARNESS_MODEL=openai/gpt-5.6-luna \
  BRANCH_LIVE_CODEX_HARNESS_THINKING=low \
  BRANCH_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS=8 \
  BRANCH_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES=800000 \
  BRANCH_LIVE_CODEX_HARNESS_DEBUG=1 \
  node --import tsx scripts/test-live.mts --quiet src/gateway/gateway-codex-harness.live.test.ts
```

GPT-5.6 native Codex matrix:

```bash
BRANCH_LIVE_CODEX_HARNESS_AUTH=api-key \
  BRANCH_LIVE_CODEX_HARNESS_TARGETS='openai/gpt-5.6-terra=ultra,openai/gpt-5.6-luna=max' \
  pnpm test:docker:live-codex-harness
```
