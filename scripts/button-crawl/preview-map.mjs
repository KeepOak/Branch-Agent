// Reads docs/parity/preview-button-map.json (PR #764) when that file is on the branch.
// The design preview is a feature and aesthetic reference, not a 1:1 spec, so every
// finding here is report-only: it never fails the job and never enters the baseline.
// Status counts are always taken from the file. 'extra' and any status this reader
// does not know are listed and then ignored by the gate.

import { readFileSync } from 'node:fs';

export const MAP_PATH = 'docs/parity/preview-button-map.json';

/** Statuses this reader understands. Anything else is informational. */
export const KNOWN_STATUSES = ['same', 'different', 'missing', 'unknown', 'extra'];

/** Layout names in the Branch App Preview's "Threads show as" menu. Report-only. */
export const PREVIEW_THREAD_LAYOUTS = ['Column', 'Emoji rail', 'Tabs above the chat', 'Side tabs'];

const REQUIRED = ['id', 'screen', 'label', 'previewAction', 'status'];

export function isInformationalStatus(status) {
  return status === 'extra' || !KNOWN_STATUSES.includes(status);
}

/** Parse a map value. Throws when the file is present but not the #764 array schema. */
export function loadPreviewMap(value) {
  if (!Array.isArray(value)) throw new Error('preview button map must be a JSON array');
  const counts = {};
  const informational = [];
  const entries = value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`preview button map entry ${index} must be an object`);
    }
    for (const field of REQUIRED) {
      if (typeof entry[field] !== 'string' || !entry[field].trim()) {
        throw new Error(`preview button map entry ${index} needs a ${field} string`);
      }
    }
    const status = entry.status.trim();
    counts[status] = (counts[status] || 0) + 1;
    const cleaned = {
      id: entry.id.trim(),
      screen: entry.screen.trim(),
      label: entry.label.trim(),
      previewAction: entry.previewAction.trim(),
      appAction: typeof entry.appAction === 'string' ? entry.appAction.trim() : '',
      status,
    };
    if (isInformationalStatus(status)) informational.push(cleaned);
    return cleaned;
  });
  return { entries, counts, informational };
}

export function readPreviewMap(filePath) {
  try {
    return { loaded: true, path: filePath, ...loadPreviewMap(JSON.parse(readFileSync(filePath, 'utf8'))) };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { loaded: false, path: filePath, entries: [], counts: {}, informational: [], reason: `${MAP_PATH} is not on this branch` };
    }
    throw error;
  }
}

function words(text) {
  const stop = new Set(['opens', 'open', 'the', 'and', 'with', 'that', 'this', 'from', 'into', 'when', 'your', 'its', 'for', 'menu', 'button']);
  return String(text || '').toLowerCase().replace(/[^a-z0-9+.# ]+/g, ' ').split(/\s+/).filter((word) => word.length > 3 && !stop.has(word));
}

/** Whether what we saw lines up with the preview destination sentence. Report-only. */
export function previewDestinationMatches(previewAction, observed) {
  const preview = String(previewAction || '');
  const haystack = [
    observed?.route, observed?.dialog, observed?.panel, observed?.toast,
    ...(observed?.menuItems || []),
  ].filter(Boolean).join(' ').toLowerCase();
  const lower = preview.toLowerCase();
  if (/\btoast\b/.test(lower)) return Boolean(observed?.toast);
  if (/\bnavigates to\b/.test(lower)) {
    const target = (lower.split('navigates to').pop() || '').replace(/[^a-z ]/g, ' ').trim().split(/\s+/)[0];
    return Boolean(target) && haystack.includes(target);
  }
  if (observed?.dead) return false;
  const wanted = words(preview);
  if (!wanted.length) return true;
  return wanted.some((word) => haystack.includes(word));
}

/** Missing and unexpected labels in the preview's thread-layout menu. Report-only. */
export function threadLayoutDiff(items) {
  const seen = [];
  for (const item of items || []) {
    const label = String(item || '').trim();
    if (label && !seen.includes(label)) seen.push(label);
  }
  return {
    missing: PREVIEW_THREAD_LAYOUTS.filter((label) => !seen.includes(label)),
    extra: seen.filter((label) => !PREVIEW_THREAD_LAYOUTS.includes(label)),
  };
}

export function isThreadLayoutMenu(menuLabel, controlLabel) {
  return /threads show as/i.test(menuLabel || '') || /how threads show/i.test(controlLabel || '');
}
