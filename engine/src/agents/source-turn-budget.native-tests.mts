// Pinned source assertions ported to named Node runner. Workflow ceiling reference is a pinned fixture.
import assert from "node:assert/strict";
import { describe, it as nodeIt } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { getStreamingContext, runWithStreamingContext } from "./source-streaming-context.ts";
import "./source-native-test-loader.mts";
const HARD_MAX_TOKENS_CEILING = 100_000_000;
const it = Object.assign(nodeIt, { each: <T extends readonly unknown[]>(rows: readonly T[]) => (name: string, fn: (...args: T) => void) => {
  rows.forEach((row, index) => nodeIt(name + " case " + index, () => fn(...row)));
} });
function expect(actual: unknown) { return {
  toEqual: (expected: unknown) => assert.deepStrictEqual(actual, expected),
  toBe: (expected: unknown) => assert.strictEqual(actual, expected),
  toBeNull: () => assert.strictEqual(actual, null),
}; }
/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  extractTurnBudgetDirectiveText,
  MAX_TURN_BUDGET_TOKENS,
  parseTurnBudgetDirective,
  TurnBudget,
  type TurnBudgetSnapshot,
} from './source-turn-budget.ts';

describe('parseTurnBudgetDirective', () => {
  it.each([
    ['+500k', 500_000, '+500k'],
    ['review all of it +1m', 1_000_000, '+1m'],
    ['go deep +2.5m please', 2_500_000, '+2.5m'],
    ['+750K', 750_000, '+750K'],
    ['(+500k)', 500_000, '+500k'],
    ['spend +500k.', 500_000, '+500k'],
    ['use 300k tokens on this', 300_000, 'use 300k tokens'],
    ['Spend 2 m tokens', 2_000_000, 'Spend 2 m tokens'],
  ])('reads %j', (text, total, directiveText) => {
    expect(parseTurnBudgetDirective(String(text))).toEqual({
      total,
      text: directiveText,
    });
  });

  it.each([
    ['no directive here'],
    // Glued to a word, or followed by more of one: not a standalone token.
    ['a+500k'],
    ['+500km'],
    ['+5bugs'],
    // No unit, or too small to be a budget.
    ['+500'],
    ['+0.5k'],
    // A slash command's arguments belong to the command.
    ['/effort +500k'],
    ['use 300k of memory'],
  ])('ignores %j', (text) => {
    expect(parseTurnBudgetDirective(String(text))).toBeNull();
  });

  it('clamps a target above the ceiling', () => {
    expect(parseTurnBudgetDirective('+1b')).toEqual({
      total: MAX_TURN_BUDGET_TOKENS,
      text: '+1b',
    });
  });

  it('takes the first valid directive in reading order', () => {
    expect(
      parseTurnBudgetDirective('use 2m tokens, or +500k if that is too much'),
    ).toEqual({ total: 2_000_000, text: 'use 2m tokens' });
    expect(parseTurnBudgetDirective('+0.1k then +800k')).toEqual({
      total: 800_000,
      text: '+800k',
    });
  });

  // One ceiling for both ways a workflow can be capped, so a directive can
  // never set a target the env cap would have refused.
  it('matches the pinned workflow ceiling fixture', () => {
    expect(MAX_TURN_BUDGET_TOKENS).toBe(HARD_MAX_TOKENS_CEILING);
  });
});

function nativeRunScope() {
  const source = readFileSync(new URL("./embedded-agent-runner/run-loop.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function runPreparedEmbeddedLoop(");
  const end = source.indexOf("async function runPreparedEmbeddedLoopInContext(", start);
  return runInNewContext(stripTypeScriptTypes(source.slice(start, end).replace("export ", "") +
    "\nrunPreparedEmbeddedLoop", { mode: "strip" }), {
    runWithStreamingContext, extractTurnBudgetDirectiveText, parseTurnBudgetDirective,
    runPreparedEmbeddedLoopInContext: async () => {
      await Promise.resolve();
      return getStreamingContext()?.turnBudget;
    },
  });
}

it("actual native run scope records typed prompt target with original ledger identity", async () => {
  const run = nativeRunScope();
  const snapshot = await run({}, { runParams: { runId: "turn", sessionId: "session", prompt: "inspect +500k" },
    laneController: { abortSignal: new AbortController().signal } });
  assert.equal(snapshot.promptId, "turn");
  assert.equal(snapshot.sessionId, "session");
  assert.equal(snapshot.budget, 500_000);
  assert.equal(snapshot.directiveText, "+500k");
  assert.equal(snapshot.outputTokensAtTurnStart, 0);
  assert.equal(getStreamingContext(), undefined);
});

it("actual native scope reads transcript prompt before expanded model prompt", async () => {
  const snapshot = await nativeRunScope()({}, { runParams: { runId: "turn", sessionId: "session",
    prompt: "injected +900k", transcriptPrompt: "review +200k" },
    laneController: { abortSignal: new AbortController().signal } });
  assert.equal(snapshot.budget, 200_000);
});

it("actual native scope ignores code directives and does not impose a default target", async () => {
  const snapshot = await nativeRunScope()({}, { runParams: { runId: "turn", sessionId: "session",
    prompt: "set `+500k` here\n```\n+1m\n```" }, laneController: { abortSignal: new AbortController().signal } });
  assert.equal(snapshot.budget, null);
  assert.equal(snapshot.directiveText, undefined);
});

describe('extractTurnBudgetDirectiveText', () => {
  const directiveIn = (
    request: Parameters<typeof extractTurnBudgetDirectiveText>[0],
  ) => parseTurnBudgetDirective(extractTurnBudgetDirectiveText(request));

  // The keyword steering notice and startup reminders are prepended to the
  // user's text; a number inside them is the harness speaking.
  it('ignores a directive inside a system reminder', () => {
    expect(
      directiveIn([
        {
          text: '<system-reminder>\nbudget +900k\n</system-reminder>\n\nrefactor it +200k',
        },
      ]),
    ).toEqual({ total: 200_000, text: '+200k' });
  });

  // ACP puts referenced content before the prompt, so the block has to be
  // removed rather than the text truncated at its first marker.
  it('ignores @-referenced file content, wherever it sits', () => {
    expect(
      directiveIn([
        { text: '\n--- Content from referenced files ---' },
        { text: '\nContent from CHANGELOG.md:\n' },
        { text: 'Downloads passed +900k this month' },
        { text: '\n--- End of content ---' },
        { text: '\nsummarize @CHANGELOG.md +300k' },
      ]),
    ).toEqual({ total: 300_000, text: '+300k' });
  });

  it('ignores MCP resource content up to its own closing marker', () => {
    expect(
      directiveIn([
        {
          text: '\n--- Content from MCP resource docs:readme [ab12cd34] ---\n',
        },
        { text: 'Costs +900k to run' },
        { text: '\n--- End of MCP resource docs:readme [ab12cd34] ---\n' },
        { text: 'read @docs:readme +300k' },
      ]),
    ).toEqual({ total: 300_000, text: '+300k' });
  });

  it('ignores code', () => {
    expect(directiveIn('set `+500k` here\n```\n+1m\n```\n')).toBeNull();
  });
});

describe('TurnBudget', () => {
  const snapshot: TurnBudgetSnapshot = {
    promptId: 'p1',
    sessionId: 's1',
    budget: 500_000,
    directiveText: '+500k',
    outputTokensAtTurnStart: 1_200,
  };

  it('has no turn until one begins', () => {
    expect(new TurnBudget().current('s1')).toBeNull();
  });

  // A /resume or /clear switches the ledger the snapshot was taken against;
  // measuring the new session from the old session's starting point would
  // report nonsense.
  it('returns the turn only for the session that opened it', () => {
    const turns = new TurnBudget();
    turns.beginTurn(snapshot);
    expect(turns.current('s1')).toEqual(snapshot);
    expect(turns.current('s2')).toBeNull();
  });

  it('replaces the previous turn, and forgets it on reset', () => {
    const turns = new TurnBudget();
    turns.beginTurn(snapshot);
    turns.beginTurn({ ...snapshot, promptId: 'p2', budget: null });
    expect(turns.current('s1')?.promptId).toBe('p2');
    turns.reset();
    expect(turns.current('s1')).toBeNull();
  });
});
