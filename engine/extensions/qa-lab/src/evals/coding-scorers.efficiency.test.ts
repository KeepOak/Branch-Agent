// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421 mastracode/sdk/src/evals/scorers/__tests__/efficiency.test.ts
// (MastraCode tool names mapped to Branch's: execute_command->exec, view->read, string_replace_lsp->edit,
// search_content->grep, find_files->find).
import { describe, it, expect } from "vitest";
import { createCodingEfficiencyScorer } from "./coding-scorers.js";
import type { EvalMessage } from "./scorer-utils.js";

function makeMsg(
  role: 'user' | 'assistant',
  toolInvocations: Array<{
    toolName: string;
    args?: Record<string, unknown>;
    result?: unknown;
    state?: string;
  }> = [],
): EvalMessage {
  return {
    id: crypto.randomUUID(),
    role,
    createdAt: new Date(),
    content: {
      format: 2 as const,
      parts: toolInvocations.map(inv => ({
        type: 'tool-invocation' as const,
        toolInvocation: {
          toolCallId: crypto.randomUUID(),
          toolName: inv.toolName,
          args: inv.args ?? {},
          result: inv.result ?? null,
          state: (inv.state ?? 'result') as 'result',
        },
      })),
    },
  };
}

function tool(name: string, args: Record<string, unknown> = {}, result: unknown = null, state = 'result') {
  return { toolName: name, args, result, state };
}

function errorTool(name: string, args: Record<string, unknown> = {}) {
  return { toolName: name, args, result: null, state: 'error' };
}

const agentInput = {
  inputMessages: [] as EvalMessage[],
  rememberedMessages: [] as EvalMessage[],
  systemMessages: [],
  taggedSystemMessages: {},
};

describe('Efficiency Scorer', () => {
  const scorer = createCodingEfficiencyScorer();

  describe('empty / minimal sessions', () => {
    it('scores 0 for empty messages', async () => {
      const { score } = await scorer.run({ input: agentInput, output: [], groundTruth: {} });
      expect(score).toBe(0);
    });

    it('scores 0 for sessions below minToolCalls threshold', async () => {
      const msgs = [makeMsg('assistant', [tool('read', { path: 'a.ts' })])];
      const { score, reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(score).toBe(0);
      expect(reason).toContain('below minimum threshold');
    });
  });

  describe('redundancy', () => {
    it('scores 1.0 when no redundant mutation calls', async () => {
      const msgs = [
        makeMsg('assistant', [
          tool('read', { path: 'a.ts' }),
          tool('edit', { path: 'a.ts', old_string: 'x', new_string: 'y' }),
          tool('read', { path: 'b.ts' }),
          tool('edit', { path: 'b.ts', old_string: 'a', new_string: 'b' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('Redundancy');
      expect(reason).toContain('0/2 redundant mutations');
    });

    it('whitelists read tools from redundancy', async () => {
      // Multiple identical view calls are OK — reads are whitelisted
      const msgs = [
        makeMsg('assistant', [
          tool('read', { path: 'a.ts' }),
          tool('read', { path: 'a.ts' }),
          tool('read', { path: 'a.ts' }),
          tool('edit', { path: 'a.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      // view is whitelisted so redundancy should only consider string_replace_lsp
      expect(reason).toContain('No mutation tools to check');
    });

    it('penalizes repeated identical mutation calls', async () => {
      const msgs = [
        makeMsg('assistant', [
          tool('edit', { path: 'a.ts', old_string: 'x', new_string: 'y' }),
          tool('edit', { path: 'a.ts', old_string: 'x', new_string: 'y' }),
          tool('read', { path: 'b.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('redundant mutations');
    });
  });

  describe('turn count', () => {
    it('scores 1.0 for sessions within normal range', async () => {
      // 3 turns with 2+ tool calls
      const msgs = [
        makeMsg('assistant', [tool('read', { path: 'a.ts' })]),
        makeMsg('assistant', [tool('edit', { path: 'a.ts' })]),
        makeMsg('assistant', [tool('read', { path: 'b.ts' })]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('Turn count');
      expect(reason).toContain('within normal range');
    });

    it('penalizes extended sessions', async () => {
      // 12 assistant turns
      const msgs = Array.from({ length: 12 }, (_, i) => makeMsg('assistant', [tool('read', { path: `file${i}.ts` })]));
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('slightly extended');
    });

    it('penalizes heavily extended sessions more', async () => {
      // 20 assistant turns
      const msgs = Array.from({ length: 20 }, (_, i) => makeMsg('assistant', [tool('read', { path: `file${i}.ts` })]));
      const result1 = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });

      // 10 assistant turns
      const msgs2 = Array.from({ length: 10 }, (_, i) => makeMsg('assistant', [tool('read', { path: `file${i}.ts` })]));
      const result2 = await scorer.run({ input: agentInput, output: msgs2, groundTruth: {} });

      expect(result1.score).toBeLessThan(result2.score ?? 0);
    });
  });

  describe('retry efficiency', () => {
    it('scores 1.0 when no retry chains', async () => {
      const msgs = [
        makeMsg('assistant', [tool('read', { path: 'a.ts' }), tool('edit', { path: 'a.ts' })]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('No retry chains');
    });

    it('detects retry chains (error then success)', async () => {
      const msgs = [
        makeMsg('assistant', [
          errorTool('edit', { path: 'a.ts' }),
          tool('edit', { path: 'a.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('retry chain');
      expect(reason).toContain('resolved quickly');
    });

    it('penalizes excessive retry chains (3+ failures before success)', async () => {
      const msgs = [
        makeMsg('assistant', [
          errorTool('edit', { path: 'a.ts' }),
          errorTool('edit', { path: 'a.ts' }),
          errorTool('edit', { path: 'a.ts' }),
          tool('edit', { path: 'a.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('excessive retry chain');
    });
  });

  describe('read-before-edit', () => {
    it('scores 1.0 when all edits have prior reads', async () => {
      const msgs = [
        makeMsg('assistant', [tool('read', { path: 'a.ts' }), tool('edit', { path: 'a.ts' })]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(reason).toContain('All');
      expect(reason).toContain('edits had prior reads');
    });

    it('penalizes edits without prior reads', async () => {
      const msgs = [
        makeMsg('assistant', [
          tool('edit', { path: 'a.ts' }),
          tool('read', { path: 'b.ts' }),
          tool('edit', { path: 'b.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      // a.ts was not read before edit
      expect(reason).toContain('edits without prior read');
    });

    it('only counts view as valid read tool (not search_content)', async () => {
      const msgs = [
        makeMsg('assistant', [
          tool('grep', { pattern: 'foo', path: 'a.ts' }),
          tool('edit', { path: 'a.ts' }),
          tool('read', { path: 'b.ts' }),
          tool('edit', { path: 'b.ts' }),
        ]),
      ];
      const { reason } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      // search_content doesn't count as read, so a.ts edit is uncovered
      expect(reason).toContain('1/2 edits without prior read');
    });
  });

  describe('overall scoring', () => {
    it('produces high score for clean, efficient session', async () => {
      const msgs = [
        makeMsg('assistant', [tool('read', { path: 'a.ts' }), tool('edit', { path: 'a.ts' })]),
        makeMsg('assistant', [tool('read', { path: 'b.ts' }), tool('edit', { path: 'b.ts' })]),
      ];
      const { score } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(score).toBeGreaterThanOrEqual(0.9);
    });

    it('produces lower score for inefficient session', async () => {
      // Many turns, edit without read, retry chains
      const msgs = [
        ...Array.from({ length: 12 }, (_, i) => makeMsg('assistant', [tool('read', { path: `file${i}.ts` })])),
        makeMsg('assistant', [
          errorTool('edit', { path: 'x.ts' }),
          errorTool('edit', { path: 'x.ts' }),
          errorTool('edit', { path: 'x.ts' }),
          tool('edit', { path: 'x.ts' }),
        ]),
      ];
      const { score } = await scorer.run({ input: agentInput, output: msgs, groundTruth: {} });
      expect(score).toBeLessThan(0.9);
    });
  });
});
