// Sidebar list checks from the owner's screenshots. These block, and they shrink the baseline.

/** The action set every Recent / computer / agent row must offer. */
export const EXPECTED_ROW_ACTIONS = ['archive', 'more', 'pin'];

const INTERNAL_ID = /\b(?:agent|trunk|room|session|a2a):[A-Za-z0-9._-]+:[A-Za-z0-9._-]+\b/;

/** Pin/Unpin, Archive/Restore, and More collapse to one name each. */
export function actionSet(names) {
  const out = [];
  for (const raw of names) {
    const name = String(raw || '').trim().toLowerCase();
    const id = name === 'pin' || name === 'unpin' ? 'pin'
      : name === 'archive' || name === 'restore' ? 'archive'
        : name === 'more' || name.startsWith('more ') ? 'more'
          : name;
    if (id && !out.includes(id)) out.push(id);
  }
  return out.sort();
}

/** Rows that show action icons but not pin, archive, and more. */
export function rowActionProblems(rows) {
  const problems = [];
  for (const row of rows) {
    if (!row?.actions?.length) continue;
    const got = actionSet(row.actions);
    if (got.join() !== EXPECTED_ROW_ACTIONS.join()) {
      problems.push({ label: row.label, got, expected: [...EXPECTED_ROW_ACTIONS] });
    }
  }
  return problems;
}

/** Visible list text that shows an internal id such as agent:name:branch. */
export function internalNameProblems(labels) {
  return [...new Set(labels.map((label) => String(label || '').trim()).filter((label) => INTERNAL_ID.test(label)))];
}

/**
 * Agent and computer rows must open the full main pane.
 * A floating or minimised popover is inconsistent with that, including when every row does it.
 */
export function inconsistentOpens(opens) {
  return opens.filter((row) => row && row.kind !== 'full').map((row) => row.label);
}
