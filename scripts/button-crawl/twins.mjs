// Settings pages that show the same controls are crawled once. A page is a twin of an earlier page when its clickable
// control names match. Only a page that clicked every one of its controls can be a source: a capped page leaves some
// controls unclicked, and a twin of it would leave them unclicked everywhere.

/** The identity of a page's controls: its page id and the sorted, unique names of its clickable controls. */
export function twinSignature(page, names) {
  return `${page}\n${[...new Set(names)].sort().join('\n')}`;
}

export class SettingsTwins {
  constructor() {
    this.sources = new Map();
  }

  /** The earlier screen this page is a twin of, or undefined when it has to be crawled. */
  twinOf(page, names) {
    return this.sources.get(twinSignature(page, names));
  }

  /** Records a screen as a twin source, only when it clicked every control it wanted. */
  record(page, names, screenId, clickedAll) {
    if (!clickedAll) return;
    const signature = twinSignature(page, names);
    if (!this.sources.has(signature)) this.sources.set(signature, screenId);
  }
}

/** Report entries for a skipped twin: every control is listed as the same as the twin, so none disappears silently. */
export function twinSkips(screenId, twin, names) {
  return [...new Set(names)].sort().map((label) => ({ screen: screenId, label, reason: `same-as ${twin}` }));
}
