# AGENT-LOOP-0033: skipped (no headless event stream to write to; wiring is a product decision)

Source: `letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba`, `src/stream-json-writer.ts`, `src/types/protocol.ts`, `src/headless-tool-events.ts`.

The upstream writer stamps every line of a headless `stream-json` run with a timestamp and writes it to stdout. Branch has no such emitter. Its `--json` options (`engine/src/cli/capability-cli.ts`, `capability-cli/image.ts`) belong to capability commands, not an agent event stream, and its `stream-json` matches are parsers for the Claude and Gemini CLI backends (`engine/src/agents/cli-output*.ts`), which read that format and do not produce it.

A writer with no caller would be dead code, which Branch's rules forbid. Choosing the flag name, the event schema and which runs emit events is a product decision.

Unblock: decide whether `branch agent` gets a stream-json output mode. If yes, port `stream-json-writer.ts` with its two test files and route every event through it.
