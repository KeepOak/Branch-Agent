// Shrink-only gate for the hard problems. A new problem fails. A problem that
// no longer reproduces fails until its baseline line is deleted.

import { screenOf } from './observe.mjs';

export function normalizeBaseline(problems) {
  const out = {};
  for (const [key, list] of Object.entries(problems || {})) {
    const next = [...new Set(list)].sort();
    if (next.length) out[key] = next;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * checks: screens the crawl finished, each { screenId, complete, keys }.
 * found: current gated problems, key -> problem names.
 */
export function compareBaseline({ baseline, found, checks }) {
  const current = normalizeBaseline(found);
  const allowed = normalizeBaseline(baseline);
  const checked = new Set();
  const complete = new Set();
  for (const check of checks || []) {
    if (check.complete) complete.add(check.screenId);
    for (const key of check.keys || []) checked.add(key);
  }
  const news = [];
  const stale = [];
  for (const [key, problems] of Object.entries(current)) {
    const known = new Set(allowed[key] || []);
    for (const problem of problems) {
      if (!known.has(problem)) news.push({ key, problem });
    }
  }
  for (const [key, problems] of Object.entries(allowed)) {
    const screenId = screenOf(key);
    if (!checked.has(key) && !complete.has(screenId)) continue;
    const now = new Set(current[key] || []);
    for (const problem of problems) {
      if (!now.has(problem)) stale.push({ key, problem });
    }
  }
  news.sort((a, b) => a.key.localeCompare(b.key) || a.problem.localeCompare(b.problem));
  stale.sort((a, b) => a.key.localeCompare(b.key) || a.problem.localeCompare(b.problem));
  return { ok: news.length === 0 && stale.length === 0, news, stale };
}

export function formatGate(result) {
  const lines = [];
  for (const item of result.news) lines.push(`New button-crawl problem: ${item.key} [${item.problem}]`);
  for (const item of result.stale) lines.push(`stale baseline entry, delete it: ${item.key} [${item.problem}]`);
  return lines;
}
