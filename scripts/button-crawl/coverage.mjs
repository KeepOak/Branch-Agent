// A Settings page is one page across its levels (Regular, Advanced, Technical): a control with the same name is the same
// control at each level. Each level clicks the controls no level has clicked yet, so the per-screen caps together reach
// more of the page. A control that no level clicks is "never clicked" and fails the gate unless it is in the allow list.

/** Controls that no level can reach, with the reason. Empty until a control is shown to be unreachable. */
export const NEVER_CLICKED_ALLOW = Object.freeze({});

const unique = (names) => [...new Set(names)];

export class PageCoverage {
  constructor() {
    this.wanted = new Map();
    this.clicked = new Map();
  }

  /**
   * Plans one level: the controls not yet clicked on this page come first, up to `room`. Names already clicked on another
   * level are covered and skipped. Returns the elements to click and the names left beyond the room.
   */
  plan(page, elements, room) {
    const wanted = this.wanted.get(page) ?? new Set();
    const done = this.clicked.get(page) ?? new Set();
    for (const el of elements) wanted.add(el.name);
    this.wanted.set(page, wanted);
    const fresh = elements.filter((el) => !done.has(el.name));
    const chosen = fresh.slice(0, room);
    const chosenNames = new Set(chosen.map((el) => el.name));
    const beyond = unique(fresh.slice(room).map((el) => el.name)).filter((name) => !chosenNames.has(name));
    return { chosen, beyond };
  }

  /** A control was clicked on this page (at any level). */
  markClicked(page, name) {
    const done = this.clicked.get(page) ?? new Set();
    done.add(name);
    this.clicked.set(page, done);
  }

  /** Controls seen on some level of a page that no level clicked, as { page, name }. */
  neverClicked() {
    const out = [];
    for (const [page, wanted] of [...this.wanted.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const done = this.clicked.get(page) ?? new Set();
      for (const name of [...wanted].sort()) if (!done.has(name)) out.push({ page, name });
    }
    return out;
  }
}

/** The gate key for a page control that no level clicked. */
export const neverKey = (page, name) => `settings:${page} :: ${name}`;
