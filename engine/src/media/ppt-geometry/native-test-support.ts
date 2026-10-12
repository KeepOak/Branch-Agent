import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
export { describe, it, afterEach } from 'node:test';

type Matcher = { kind: 'object' | 'array' | 'string'; value: unknown };
function partialMatches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && 'kind' in expected && 'value' in expected) return matches(actual, expected);
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return actual !== null && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => partialMatches((actual as Record<string, unknown>)[key], value));
  }
  return matches(actual, expected);
}
function matches(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === 'object' && 'kind' in expected && 'value' in expected) {
    const matcher = expected as Matcher;
    if (matcher.kind === 'string') return typeof actual === 'string' && (matcher.value as RegExp).test(actual);
    if (matcher.kind === 'array') return Array.isArray(actual) && (matcher.value as unknown[]).every(item => actual.some(value => matches(value, item)));
    return partialMatches(actual, matcher.value);
  }
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matches(actual[index], value));
  return isDeepStrictEqual(actual, expected);
}
export const expect = Object.assign((actual: unknown) => ({
  toBe(expected: unknown) { assert.strictEqual(actual, expected); },
  toEqual(expected: unknown) { assert.ok(matches(actual, expected), `Actual ${JSON.stringify(actual)} did not match expected ${JSON.stringify(expected)}`); },
  toHaveLength(expected: number) { assert.strictEqual((actual as { length: number }).length, expected); },
  toMatchObject(expected: unknown) { assert.ok(matches(actual, { kind: 'object', value: expected })); },
  toBeUndefined() { assert.strictEqual(actual, undefined); },
  toBeDefined() { assert.notStrictEqual(actual, undefined); },
  toThrow(expected: RegExp) { assert.throws(actual as () => unknown, expected); },
  toContain(expected: string) { assert.ok((actual as string).includes(expected)); },
  not: { toBe(expected: unknown) { assert.notStrictEqual(actual, expected); } },
  rejects: { async toThrow(expected?: string | RegExp) {
    await assert.rejects(actual as Promise<unknown>, (error: unknown) => expected === undefined || (expected instanceof RegExp ? expected.test(String(error)) : String(error).includes(expected)));
  } },
  resolves: { async toEqual(expected: unknown) { assert.deepStrictEqual(await actual, expected); } },
}), {
  objectContaining: (value: unknown): Matcher => ({ kind: 'object', value }),
  arrayContaining: (value: unknown[]): Matcher => ({ kind: 'array', value }),
  stringMatching: (value: RegExp): Matcher => ({ kind: 'string', value }),
});
