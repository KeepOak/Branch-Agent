#!/usr/bin/env node
// Turns one run's findings.jsonl into UI-AUDIT lines: ID, place › control, OS, what happened, repro, evidence.
// Usage: node scripts/frame-qa/audit-lines.mjs <run-dir> <os> [audit-file]
// Without an audit file it prints the lines. With one, it appends a single block under
// "## QA <os> (frame-level)" in one write, so lines from other lanes are never rewritten.

import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OS_LABEL = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };
// Timing findings from the Mac and Windows machines are load-affected while they run other agents.
export const TIMING_KINDS = new Set(['slow-first-paint', 'slow', 'flicker', 'idle-churn', 'blank-before-content']);

const ms = (value) => (value === null || value === undefined ? 'n/a' : `${Math.round(value)} ms`);

/** One sentence of exact facts for a finding. */
export function summarize(f) {
  const d = f.detail || {};
  const t = f.timings || {};
  switch (f.kind) {
    case 'flicker': return `picture changed and returned to the earlier frame within ${(d.flickerGapsMs || []).join(', ')} ms; first change ${ms(t.firstChangeMs)}`;
    case 'slow-first-paint': return `first change ${ms(t.firstChangeMs)}, first stable frame ${ms(t.stableMs)} (limit 200 ms)`;
    case 'idle-churn': return typeof f.detail === 'string' ? f.detail : `picture changed in ${d.idleBins} of 3 one-second bins, 2-5 s after the last input`;
    case 'blank-before-content': return `flat frames before content; content after ${ms(d.blankBefore?.contentAfterMs)}`;
    case 'layout-shift': return `layout shift without input: value ${d.shifts?.[0]?.value ?? '?'} at ${d.shifts?.[0]?.node ?? '?'}`;
    case 'scroll-reset': return `scrollTop jumped ${d.jumps?.[0]?.from ?? '?'} to ${d.jumps?.[0]?.to ?? '?'} with no input on ${d.jumps?.[0]?.el ?? '?'}`;
    case 'focus-loss': return typeof f.detail === 'string' ? `${f.detail} (candidate: a non-modal popup can let Tab leave it)` : 'focus fell to body';
    case 'dead-end': return 'click changed nothing visible within 2 s (no route, dialog, menu, text, focus or hash change)';
    case 'click-intercepted': return `click at the control's centre landed on ${d.clickPoint || 'another element'}`;
    case 'console-error': return `console error: ${(d.errors || [])[0] || 'see run log'}`;
    case 'react-warning': return `React warning: ${(d.warnings || [])[0] || 'see run log'}`;
    case 'unhandled-rejection': return `unhandled rejection: ${(d.rejections || [])[0] || ''}`;
    case 'request-failed': return `request failed: ${(d.failed || [])[0] || ''}`;
    default: return typeof f.detail === 'string' ? f.detail : f.kind;
  }
}

/** Builds the line for one finding. */
export function lineFor(f, id, os) {
  const label = OS_LABEL[os] || os;
  // Timing findings from machines under load (the Mac and the Windows machine, both short on memory) are load-affected until reproduced on a quiet machine.
  const tag = TIMING_KINDS.has(f.kind) && (os === 'mac' || os === 'windows') ? ' [load-affected]' : '';
  const place = `${f.root} › ${f.control}`;
  const repro = (f.repro || []).join(' → ');
  const evidence = (f.evidence || []).map((file) => basename(file)).join(', ') || 'none';
  return `- ${id} | ${place} | ${label} (Chromium on ${os}) | ${f.kind}${tag}: ${summarize(f)} | repro: ${repro || `open ${f.root}`} | evidence: ${evidence}`;
}

/** One line per distinct problem: page-level findings by text, node findings by kind, place, control and repro. */
export function uniqueFindings(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    // Page-level problems (contrast, clipped text) repeat under every overlay. Keep one line per distinct text.
    const pageLevel = typeof f.detail === 'string' && f.kind !== 'idle-churn';
    const key = pageLevel
      ? [f.kind, f.detail].join('|')
      : [f.kind, f.root, f.control, (f.repro || []).join('>')].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** One line per unique finding with a stable ID for this OS. */
export function auditLines(findings, os) {
  const prefix = `QA-${os.toUpperCase()}`;
  return uniqueFindings(findings).map((f, index) => lineFor(f, `${prefix}-${String(index + 1).padStart(3, '0')}`, os));
}

/** Appends one block to the audit file in a single write. Creates the heading only once. */
export function appendBlock(file, os, lines) {
  const heading = `## QA ${os} (frame-level)`;
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const block = `${existing.includes(heading) ? '' : `\n${heading}\n`}${lines.join('\n')}\n`;
  appendFileSync(file, block);
}

function readFindings(runDir) {
  const file = join(runDir, 'findings.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const [runDir, os, auditFile] = process.argv.slice(2);
  const lines = auditLines(readFindings(runDir), os);
  if (auditFile) {
    appendBlock(auditFile, os, lines);
    console.log(`appended ${lines.length} lines for ${os} to ${auditFile}`);
  } else {
    console.log(lines.join('\n'));
  }
}
