// Adapted from mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421
// packages/evals/src/scorers/code/checks/index.test.ts, completeness/index.test.ts (quick checks + code scorers).
import { describe, expect, test, it, beforeEach } from "vitest";
import {
  checks,
  includes,
  excludes,
  equals,
  matches,
  similarity,
  calledTool,
  didNotCall,
  toolOrder,
  maxToolCalls,
  usedNoTools,
  noToolErrors,
} from "./checks.js";
import { createCompletenessScorer, createContentSimilarityScorer } from "./code-scorers.js";
import { createAgentTestRun, createTestMessage, createToolInvocation } from "./scorer-utils.js";

// ─── Native tool-failure fixtures ──────────────────────────────────────────────

/**
 * A message carrying a natively thrown tool call.
 *
 * Core persists a thrown call in `content.parts` as `state: 'output-error'` with
 * `errorText`; the legacy `toolInvocations` array cannot represent that state, so
 * these fixtures must use parts.
 */
function thrownToolMessage(toolName: string, toolCallId: string, errorText = 'Tool failed') {
  return createTestMessage({
    content: 'That failed.',
    role: 'assistant',
    id: `thrown-${toolCallId}`,
    parts: [
      { type: 'text', text: 'That failed.' },
      {
        type: 'tool-invocation',
        toolInvocation: createToolInvocation({ toolCallId, toolName, args: {}, state: 'output-error', errorText }),
      },
    ],
  });
}

/**
 * A message where one call succeeded and one threw, and the legacy array mirrors
 * only the success — the mixed shape that hid the failure entirely.
 */
function mixedToolMessage(toolName: string) {
  const good = createToolInvocation({
    toolCallId: 'good',
    toolName,
    args: {},
    result: { saved: true },
    state: 'result',
  });
  const bad = createToolInvocation({
    toolCallId: 'bad',
    toolName,
    args: {},
    state: 'output-error',
    errorText: 'Save failed',
  });
  return createTestMessage({
    content: 'Partly done.',
    role: 'assistant',
    id: 'mixed',
    toolInvocations: [good],
    parts: [
      { type: 'text', text: 'Partly done.' },
      { type: 'tool-invocation', toolInvocation: good },
      { type: 'tool-invocation', toolInvocation: bad },
    ],
  });
}

// ─── includes ─────────────────────────────────────────────────────────────────

describe('checks.includes', () => {
  test('should score 1 when output contains the expected text (case-insensitive)', async () => {
    const scorer = checks.includes('sunny');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'What is the weather?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'It is Sunny and warm today.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when output does not contain the expected text', async () => {
    const scorer = checks.includes('rainy');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'What is the weather?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'It is sunny and warm.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should respect ignoreCase: false', async () => {
    const scorer = checks.includes('Sunny', { ignoreCase: false });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Weather?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'It is sunny and warm.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(includes).toBe(checks.includes);
  });
});

// ─── excludes ─────────────────────────────────────────────────────────────────

describe('checks.excludes', () => {
  test('should score 1 when output does not contain the unwanted text', async () => {
    const scorer = checks.excludes('error');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Hi there! How can I help?', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when output contains the unwanted text', async () => {
    const scorer = checks.excludes('error');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'An error occurred while processing.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(excludes).toBe(checks.excludes);
  });
});

// ─── equals ───────────────────────────────────────────────────────────────────

describe('checks.equals', () => {
  test('should score 1 when output exactly matches (case-insensitive)', async () => {
    const scorer = checks.equals('Hello, world!');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Greet me', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'hello, world!', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when output does not exactly match', async () => {
    const scorer = checks.equals('Hello, world!');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Greet me', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Hello, world! How are you?', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should respect ignoreCase: false', async () => {
    const scorer = checks.equals('Hello', { ignoreCase: false });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Greet', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'hello', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(equals).toBe(checks.equals);
  });
});

// ─── matches ──────────────────────────────────────────────────────────────────

describe('checks.matches', () => {
  test('should score 1 when output matches the regex pattern', async () => {
    const scorer = checks.matches(/\d+°[FC]/);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Temp?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'The temperature is 72°F today.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when output does not match the regex', async () => {
    const scorer = checks.matches(/\d+°[FC]/);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Temp?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'It is warm outside.', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('exact mode anchors the pattern', async () => {
    const scorer = checks.matches(/hello/, { exact: true });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Greet', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'say hello world', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test.each(['g', 'y'])('scores every matching run when the pattern uses the %s flag', async flag => {
    const scorer = checks.matches(new RegExp('\\d+°[FC]', flag));
    const run = (content: string) =>
      createAgentTestRun({
        inputMessages: [createTestMessage({ content: 'Temp?', role: 'user', id: 'i1' })],
        output: [createTestMessage({ content, role: 'assistant', id: 'o1' })],
      });

    expect((await scorer.run(run('72°F'))).score).toBe(1);
    expect((await scorer.run(run('72°F'))).score).toBe(1);
  });

  test('named export matches namespace', () => {
    expect(matches).toBe(checks.matches);
  });
});

// ─── similarity ───────────────────────────────────────────────────────────────

describe('checks.similarity', () => {
  test('should return a score between 0 and 1', async () => {
    const scorer = checks.similarity('Sunny, 72°F');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Weather?', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Sunny, 73°F', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  test('should return 1 for identical strings', async () => {
    const scorer = checks.similarity('hello world');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Say hi', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'hello world', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should return close to 0 for completely different strings', async () => {
    const scorer = checks.similarity('abcdefgh');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Test', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'xyz12345', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBeLessThan(0.3);
  });

  test('should score 1 when similarity meets threshold', async () => {
    const scorer = checks.similarity('hello world', { threshold: 0.8 });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Say hi', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'hello world', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when similarity is below threshold', async () => {
    const scorer = checks.similarity('hello world', { threshold: 0.9 });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Say hi', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'xyz12345', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(similarity).toBe(checks.similarity);
  });
});

// ─── calledTool ───────────────────────────────────────────────────────────────

describe('checks.calledTool', () => {
  test('should score 1 when the specified tool was called', async () => {
    const scorer = checks.calledTool('get_weather');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Weather?', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Checking weather...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'get_weather',
              args: { city: 'NYC' },
              result: { temp: 72 },
              state: 'result',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when the specified tool was not called', async () => {
    const scorer = checks.calledTool('get_weather');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Weather?', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Let me search...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'search',
              args: {},
              result: {},
              state: 'result',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should respect times option', async () => {
    const scorer = checks.calledTool('search', { times: 2 });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Search', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Searching...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'search', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'search', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when tool called fewer than required times', async () => {
    const scorer = checks.calledTool('search', { times: 3 });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Search', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Searching...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'search', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'search', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 1 when the tool was called but threw', async () => {
    const scorer = checks.calledTool('save');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save this', role: 'user', id: 'i1' })],
      output: [thrownToolMessage('save', 'bad', 'Save failed')],
    });

    const result = await scorer.run(run);
    // The tool ran; a thrown call is still a call.
    expect(result.score).toBe(1);
  });

  test('named export matches namespace', () => {
    expect(calledTool).toBe(checks.calledTool);
  });
});

// ─── didNotCall ───────────────────────────────────────────────────────────────

describe('checks.didNotCall', () => {
  test('should score 1 when the tool was not called', async () => {
    const scorer = checks.didNotCall('delete_user');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Hi there!', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when the tool was called', async () => {
    const scorer = checks.didNotCall('delete_user');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Delete my account', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Deleting...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'delete_user',
              args: {},
              result: {},
              state: 'result',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 0 when the tool was called but threw', async () => {
    const scorer = checks.didNotCall('save');
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save this', role: 'user', id: 'i1' })],
      output: [thrownToolMessage('save', 'bad', 'Save failed')],
    });

    const result = await scorer.run(run);
    // A thrown call is still a call, so this must not pass.
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(didNotCall).toBe(checks.didNotCall);
  });
});

// ─── toolOrder ────────────────────────────────────────────────────────────────

describe('checks.toolOrder', () => {
  test('should score 1 when tools are called in expected order', async () => {
    const scorer = checks.toolOrder(['search', 'summarize']);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Research this', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Working on it...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'search', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'summarize', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 1 with extra tools in between (relaxed)', async () => {
    const scorer = checks.toolOrder(['search', 'summarize']);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Research', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Working...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'search', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'validate', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c3', toolName: 'summarize', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when tools are called in wrong order', async () => {
    const scorer = checks.toolOrder(['search', 'summarize']);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Research', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Working...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'summarize', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'search', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 0 when a required tool is missing', async () => {
    const scorer = checks.toolOrder(['search', 'summarize']);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Research', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Working...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'search', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 1 when a thrown call is part of the expected order', async () => {
    const scorer = checks.toolOrder(['search', 'save']);
    const good = createToolInvocation({
      toolCallId: 's1',
      toolName: 'search',
      args: {},
      result: { results: [] },
      state: 'result',
    });
    const bad = createToolInvocation({
      toolCallId: 's2',
      toolName: 'save',
      args: {},
      state: 'output-error',
      errorText: 'Save failed',
    });
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Search then save', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Done.',
          role: 'assistant',
          id: 'o1',
          parts: [
            { type: 'text', text: 'Done.' },
            { type: 'tool-invocation', toolInvocation: good },
            { type: 'tool-invocation', toolInvocation: bad },
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    // Dropping the thrown call would leave only ['search'] and break the sequence.
    expect(result.score).toBe(1);
    expect(result.preprocessStepResult?.actualTools).toEqual(['search', 'save']);
  });

  test('named export matches namespace', () => {
    expect(toolOrder).toBe(checks.toolOrder);
  });
});

// ─── maxToolCalls ─────────────────────────────────────────────────────────────

describe('checks.maxToolCalls', () => {
  test('should score 1 when tool calls are within limit', async () => {
    const scorer = checks.maxToolCalls(3);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Do something', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Done.',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'a', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'b', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when tool calls exceed limit', async () => {
    const scorer = checks.maxToolCalls(1);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Do something', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Done.',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'a', args: {}, result: {}, state: 'result' }),
            createToolInvocation({ toolCallId: 'c2', toolName: 'b', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 0 when a hidden thrown call pushes the run over the limit', async () => {
    const scorer = checks.maxToolCalls(1);
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save these', role: 'user', id: 'i1' })],
      // Two real calls, but the legacy array mirrors only the successful one.
      output: [mixedToolMessage('save')],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
    expect(result.preprocessStepResult?.count).toBe(2);
  });

  test('named export matches namespace', () => {
    expect(maxToolCalls).toBe(checks.maxToolCalls);
  });
});

// ─── usedNoTools ──────────────────────────────────────────────────────────────

describe('checks.usedNoTools', () => {
  test('should score 1 when no tools were used', async () => {
    const scorer = checks.usedNoTools();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Hi! How can I help?', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when tools were used', async () => {
    const scorer = checks.usedNoTools();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Checking...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({ toolCallId: 'c1', toolName: 'check', args: {}, result: {}, state: 'result' }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 0 when the only tool call threw', async () => {
    const scorer = checks.usedNoTools();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save this', role: 'user', id: 'i1' })],
      output: [thrownToolMessage('save', 'bad', 'Save failed')],
    });

    const result = await scorer.run(run);
    // A thrown call is still tool use.
    expect(result.score).toBe(0);
  });

  test('named export matches namespace', () => {
    expect(usedNoTools).toBe(checks.usedNoTools);
  });
});

// ─── noToolErrors ─────────────────────────────────────────────────────────────

describe('checks.noToolErrors', () => {
  test('should score 1 when all tool calls succeeded', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Do stuff', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Done!',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'search',
              args: {},
              result: { data: 'found' },
              state: 'result',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when a tool call has an error result', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Do stuff', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Trying...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'search',
              args: {},
              result: { error: 'Network timeout' },
              state: 'result',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 0 when a tool call has state "call" (incomplete)', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Do stuff', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'Calling tool...',
          role: 'assistant',
          id: 'o1',
          toolInvocations: [
            createToolInvocation({
              toolCallId: 'c1',
              toolName: 'search',
              args: {},
              result: {},
              state: 'call',
            }),
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
  });

  test('should score 1 when no tools were called at all', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Hello', role: 'user', id: 'i1' })],
      output: [createTestMessage({ content: 'Hi!', role: 'assistant', id: 'o1' })],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(1);
  });

  test('should score 0 when a tool call threw natively (state "output-error")', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save this', role: 'user', id: 'i1' })],
      output: [thrownToolMessage('save', 'bad', 'Save failed')],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
    expect(result.preprocessStepResult?.errorCount).toBe(1);
    expect(result.preprocessStepResult?.totalCalls).toBe(1);
  });

  test('should score 0 and count both calls when only the failure lives in parts', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save these', role: 'user', id: 'i1' })],
      output: [mixedToolMessage('save')],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
    expect(result.preprocessStepResult?.errorCount).toBe(1);
    expect(result.preprocessStepResult?.totalCalls).toBe(2);
  });

  test('should score 0 when a result is flagged isError without an error field', async () => {
    const scorer = checks.noToolErrors();
    const run = createAgentTestRun({
      inputMessages: [createTestMessage({ content: 'Save this', role: 'user', id: 'i1' })],
      output: [
        createTestMessage({
          content: 'That failed.',
          role: 'assistant',
          id: 'o1',
          parts: [
            { type: 'text', text: 'That failed.' },
            {
              type: 'tool-invocation',
              toolInvocation: createToolInvocation({
                toolCallId: 'c1',
                toolName: 'save',
                args: {},
                result: { saved: false },
                state: 'result',
                isError: true,
              }),
            },
          ],
        }),
      ],
    });

    const result = await scorer.run(run);
    expect(result.score).toBe(0);
    expect(result.preprocessStepResult?.errorCount).toBe(1);
  });

  test('named export matches namespace', () => {
    expect(noToolErrors).toBe(checks.noToolErrors);
  });
});

describe('CompletenessMetric', () => {
  let scorer: ReturnType<typeof createCompletenessScorer>;

  beforeEach(() => {
    scorer = createCompletenessScorer();
  });

  describe('basic functionality', () => {
    it('should return high score for identical text', async () => {
      const text = 'The quick brown fox jumps over the lazy dog';

      const inputMessages = [createTestMessage({ content: text, role: 'user', id: 'test-input' })];
      const output = [createTestMessage({ content: text, role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output });
      const result = await scorer.run(run);
      expect(result.score).toBeCloseTo(1.0);
      expect(result.preprocessStepResult?.elementCounts).toBeDefined();
    });

    it('should return lower score for simplified text missing elements', async () => {
      const original = 'The quick brown fox jumps over the lazy dog';
      const simplified = 'The fox jumps over the dog';

      const inputMessages = [createTestMessage({ content: original, role: 'user', id: 'test-input' })];
      const output = [createTestMessage({ content: simplified, role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output });
      const result = await scorer.run(run);

      expect(result.score).toBeLessThan(1.0);
      expect(result.score).toBeGreaterThan(0.5);

      expect(result.preprocessStepResult?.missingElements).toContain('brown');
      expect(result.preprocessStepResult?.missingElements).toContain('lazy');
    });

    it('should handle completely different texts', async () => {
      const original = 'The weather is sunny today';
      const simplified = 'I like to eat pizza';

      const inputMessages = [createTestMessage({ content: original, role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: simplified, role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);

      expect(result.score).toBeLessThan(0.3);
      const { input, output } = result.preprocessStepResult?.elementCounts as { input: number; output: number };
      expect(input).toBeGreaterThan(0);
      expect(output).toBeGreaterThan(0);
    });
  });

  describe('edge cases', () => {
    it('should handle both empty strings', async () => {
      const inputMessages = [createTestMessage({ content: '', role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: '', role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);
      expect(result.score).toBe(1);
      const { input, output } = result.preprocessStepResult?.elementCounts as { input: number; output: number };
      expect(input).toBe(0);
      expect(output).toBe(0);
    });

    it('should handle empty original string', async () => {
      const inputMessages = [createTestMessage({ content: '', role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: 'some text', role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);
      expect(result.score).toBe(0);
    });

    it('should handle whitespace-only strings', async () => {
      const inputMessages = [createTestMessage({ content: '   \n  ', role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: '  \n  ', role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);
      expect(result.score).toBe(1);
      const { input, output } = result.preprocessStepResult?.elementCounts as { input: number; output: number };
      expect(input).toBe(0);
      expect(output).toBe(0);
    });

    it('should handle null and undefined inputs', async () => {
      await expect(
        scorer.run(createAgentTestRun({ inputMessages: null as never, output: null as never })),
      ).rejects.toThrow();
      await expect(
        scorer.run(createAgentTestRun({ inputMessages: undefined, output: undefined as never })),
      ).rejects.toThrow();
    });
  });

  describe('special cases', () => {
    it('should handle lists and enumerations', async () => {
      const inputMessages = [
        createTestMessage({ content: 'apples, oranges, and bananas', role: 'user', id: 'test-input' }),
      ];
      const outputMessages = [
        createTestMessage({ content: 'apples and bananas', role: 'assistant', id: 'test-output' }),
      ];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);
      expect(result.score).toBeLessThan(0.8);
      expect(result.preprocessStepResult?.missingElements).toContain('oranges');
    });

    it('should handle repeated elements', async () => {
      const inputMessages = [createTestMessage({ content: 'cat cat cat cats', role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: 'cat cats', role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);
      expect(result.score).toBeGreaterThan(0.7);
    });

    it('should handle long and multi-paragraph text', async () => {
      const original = `First paragraph about AI.
        Second paragraph about ML.
        Third paragraph about DL.`;
      const simplified = `First para about AI.
        Second para about ML.`;

      const inputMessages = [createTestMessage({ content: original, role: 'user', id: 'test-input' })];
      const outputMessages = [createTestMessage({ content: simplified, role: 'assistant', id: 'test-output' })];

      const run = createAgentTestRun({ inputMessages, output: outputMessages });
      const result = await scorer.run(run);

      expect(result.score).toBeGreaterThan(0.5);
      expect(result.preprocessStepResult?.missingElements).toBeDefined();
    });
  });
});

describe("createContentSimilarityScorer", () => {
  test("scores identical input and output as 1 and different text low", async () => {
    const scorer = createContentSimilarityScorer();
    const same = await scorer.run(
      createAgentTestRun({
        inputMessages: [createTestMessage({ content: "Hello  World", role: "user", id: "i1" })],
        output: [createTestMessage({ content: "hello world", role: "assistant", id: "o1" })],
      }),
    );
    expect(same.score).toBe(1);
    expect(same.preprocessStepResult?.processedInput).toBe("hello world");

    const different = await scorer.run(
      createAgentTestRun({
        inputMessages: [createTestMessage({ content: "abcdefgh", role: "user", id: "i1" })],
        output: [createTestMessage({ content: "xyz12345", role: "assistant", id: "o1" })],
      }),
    );
    expect(different.score).toBeLessThan(0.3);
  });
});
