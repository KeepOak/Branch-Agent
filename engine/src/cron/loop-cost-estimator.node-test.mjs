/*
 * Harvested from cobusgreyling/loop-engineering@10a5f859a16a69d3ee4942b8b7b8b3af781c08e2
 * AUTOMATION-0197; scenarios use source pattern coefficients, not metered usage.
 * MIT License
 *
 * Copyright (c) 2026 Cobus Greyling and contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Upstream tests copied with only their estimator import adapted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidLevel,
  cadenceToRunsPerDay,
  runsPerDayForInterval,
  estimateCost,
  parseOrchestration,
} from './loop-cost-estimator.ts';

const CI_SWEEPER = {
  id: 'ci-sweeper',
  name: 'CI Sweeper',
  cadence: '5m-15m',
  token_cost: 'very-high',
  cost: {
    tokens_noop: 5000,
    tokens_report: 50000,
    tokens_action: 200000,
    suggested_daily_cap: 1000000,
    early_exit_required: true,
  },
};

test('runsPerDayForInterval: 15m = 96', () => {
  assert.equal(runsPerDayForInterval('15m'), 96);
});

test('runsPerDayForInterval: 1d = 1', () => {
  assert.equal(runsPerDayForInterval('1d'), 1);
});

test('runsPerDayForInterval rejects a zero cadence', () => {
  assert.throws(() => runsPerDayForInterval('0m'), /greater than zero/);
});

test('cadenceToRunsPerDay: range uses fastest by default', () => {
  assert.equal(cadenceToRunsPerDay('5m-15m'), 288);
});

test('cadenceToRunsPerDay: conservative uses slowest', () => {
  assert.equal(cadenceToRunsPerDay('5m-15m', true), 96);
});

test('estimateCost: ci-sweeper 15m L2 warns on high spend', () => {
  const r = estimateCost({
    pattern: CI_SWEEPER,
    cadence: '15m',
    level: 'L2',
  });
  assert.equal(r.runsPerDay, 96);
  assert.ok(r.scenarios.action.tokensPerDay > r.suggestedDailyCap);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.scenarios.realistic.tokensPerDay < r.scenarios.action.tokensPerDay);
});

test('assertValidLevel: rejects unknown level', () => {
  assert.throws(() => assertValidLevel('garbage'), /Invalid level/);
});

test('parseOrchestration: modes map to expected multipliers', () => {
  assert.equal(parseOrchestration(undefined).multiplier, 1);
  assert.equal(parseOrchestration('single').multiplier, 1);
  assert.equal(parseOrchestration('maker-checker').multiplier, 2);
  assert.equal(parseOrchestration('parallel:3').multiplier, 4);
  assert.equal(parseOrchestration('debate:2').multiplier, 3);
});

test('parseOrchestration: rejects bad specs', () => {
  assert.throws(() => parseOrchestration('parallel:1'), /parallel/);
  assert.throws(() => parseOrchestration('debate:0'), /debate/);
  assert.throws(() => parseOrchestration('garbage'), /Invalid orchestration/);
});

test('estimateCost: orchestration scales only the action path', () => {
  const base = estimateCost({ pattern: CI_SWEEPER, cadence: '15m', level: 'L2' });
  const mc = estimateCost({
    pattern: CI_SWEEPER,
    cadence: '15m',
    level: 'L2',
    orchestration: 'maker-checker',
  });
  assert.equal(mc.orchestration.mode, 'maker-checker');
  assert.equal(mc.orchestration.multiplier, 2);
  // action doubles; no-op and full-triage scans are untouched.
  assert.equal(mc.scenarios.action.tokensPerRun, base.scenarios.action.tokensPerRun * 2);
  assert.equal(mc.scenarios.noop.tokensPerRun, base.scenarios.noop.tokensPerRun);
  assert.equal(mc.scenarios.report.tokensPerRun, base.scenarios.report.tokensPerRun);
  // realistic blend rises because its action component is scaled.
  assert.ok(mc.scenarios.realistic.tokensPerDay > base.scenarios.realistic.tokensPerDay);
});

test('estimateCost: default single leaves action unchanged and adds no warning', () => {
  const r = estimateCost({ pattern: CI_SWEEPER, cadence: '15m', level: 'L2' });
  assert.equal(r.orchestration.mode, 'single');
  assert.equal(r.scenarios.action.tokensPerRun, CI_SWEEPER.cost.tokens_action);
  assert.ok(!r.warnings.some((w) => /Orchestration/.test(w)));
});

test('estimateCost: deep fan-out warns', () => {
  const r = estimateCost({
    pattern: CI_SWEEPER,
    cadence: '15m',
    level: 'L2',
    orchestration: 'parallel:4',
  });
  assert.equal(r.orchestration.multiplier, 5);
  assert.ok(r.warnings.some((w) => /Orchestration/.test(w)));
});

test('estimateCost: daily-triage 1d L1 is cheap', () => {
  const r = estimateCost({
    pattern: {
      id: 'daily-triage',
      name: 'Daily Triage',
      cadence: '1d',
      token_cost: 'low',
      cost: {
        tokens_noop: 5000,
        tokens_report: 50000,
        tokens_action: 200000,
        suggested_daily_cap: 100000,
        early_exit_required: false,
      },
    },
    level: 'L1',
  });
  assert.equal(r.runsPerDay, 1);
  assert.ok(r.scenarios.realistic.tokensPerDay <= 100000);
});
