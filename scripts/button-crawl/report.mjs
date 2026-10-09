// JSON and Markdown reports. Preview-map notes are included and are not gated.

import { GATED_PROBLEMS } from './observe.mjs';

export function countProblems(found) {
  const counts = Object.fromEntries(GATED_PROBLEMS.map((problem) => [problem, 0]));
  for (const problems of Object.values(found || {})) {
    for (const problem of problems) {
      if (problem in counts) counts[problem] += 1;
    }
  }
  return counts;
}

/** The baseline lines a reviewer would hand out, worst first. */
export function worstProblems(found, limit = 20) {
  return Object.entries(found || {})
    .map(([key, problems]) => {
      const [screen, ...rest] = key.split(' :: ');
      return { key, screen, label: rest.join(' :: '), problems: [...problems].sort(), weight: problems.length };
    })
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export function markdownReport(report) {
  const counts = countProblems(report.gated || {});
  const countLines = Object.entries(counts).filter(([, n]) => n > 0).map(([problem, n]) => `- ${problem}: ${n}`);
  const worst = worstProblems(report.gated || {}, 20)
    .map((item) => `- ${item.screen} — ${item.label} (${item.problems.join(', ')})`);
  const skipped = report.skipped || [];
  const skipCounts = {};
  for (const item of skipped) skipCounts[item.reason] = (skipCounts[item.reason] || 0) + 1;
  const map = report.previewMap || { loaded: false };
  const mapCounts = Object.entries(map.counts || {}).map(([status, n]) => `- ${status}: ${n}`);
  const info = (map.informational || []).slice(0, 30)
    .map((entry) => `- ${entry.status}: ${entry.screen} — ${entry.label} (${entry.id})`);
  const comparisons = (map.comparisons || []).filter((item) => !item.match).slice(0, 30)
    .map((item) => `- ${item.screen} — ${item.label}: preview says “${item.previewAction}”`);
  const thread = report.threadMenu;
  const lines = [
    '# Button crawl',
    '',
    `Runtime: ${Math.round((report.runtimeMs || 0) / 1000)}s. Screens: ${report.screenCount || 0}. Controls clicked: ${report.clickCount || 0}. Skipped: ${skipped.length} (${Object.entries(skipCounts).map(([reason, n]) => `${n} ${reason}`).join(', ') || 'none'}).`,
    '',
    'Caps: ' + (report.caps ? `${report.caps.maxScreens} screens, ${report.caps.maxPerScreen} controls a screen, ${report.caps.maxClicks} clicks, overlay depth ${report.caps.maxDepth}.` : 'see the crawler.'),
    '',
    '## Gated problems',
    '',
    countLines.length ? countLines.join('\n') : 'None.',
    '',
    '## Worst 20',
    '',
    worst.length ? worst.join('\n') : 'None.',
    '',
    '## Preview reference (does not fail the job)',
    '',
  ];
  if (!map.loaded) {
    lines.push(`Skipped. ${map.reason || 'The preview button map is not on this branch.'}. Pull request #764 adds docs/parity/preview-button-map.json.`);
  } else {
    lines.push(`Read ${map.entries || 0} entries from the preview button map.`);
    lines.push('');
    lines.push('Status counts from the file:');
    lines.push('');
    lines.push(mapCounts.join('\n') || '- none');
    lines.push('');
    lines.push('Informational statuses (`extra`, and any status this job does not know) are listed and not baselined:');
    lines.push('');
    lines.push(info.length ? info.join('\n') : 'None.');
    lines.push('');
    lines.push('Clicked controls whose result does not match the preview destination:');
    lines.push('');
    lines.push(comparisons.length ? comparisons.join('\n') : 'None of the clicked controls disagreed, or none matched a map label.');
  }
  lines.push('');
  lines.push('## Threads show as');
  lines.push('');
  if (!thread) {
    lines.push('The How threads show menu was not opened on this run.');
  } else {
    lines.push(`Saw: ${thread.items.join(', ') || '(empty)'}.`);
    if (thread.missing.length) lines.push(`Missing from the preview set: ${thread.missing.join(', ')}.`);
    if (thread.extra.length) lines.push(`Not in the preview set: ${thread.extra.join(', ')}.`);
    if (!thread.missing.length && !thread.extra.length) lines.push('The menu matches the preview’s four layouts.');
    lines.push('This is a preview reference only. It does not fail the job.');
  }
  lines.push('');
  return lines.join('\n');
}
