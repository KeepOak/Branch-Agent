// Depth-first, exhaustive walk of every control with a visited graph.
// The walk knows nothing about the browser. It drives an adapter with these methods:
//   beginRoot(root)            open the root screen in a fresh context
//   listControls(overlayOpen)  -> [{ name, occurrence, region, disabled, selected, href }]
//   skipReason(control)        -> string or null (destructive, external, disabled)
//   signature()                -> string fingerprint of the base state (route plus overlay)
//   replay(root, path)         mount the root and click each step of the path again
//   act(control)               click like a person and observe -> observation
//   overlayState()             -> string fingerprint of the open menu or dialog, or null
//   escape()                   press Escape and report whether the overlay is still open
//   endRoot(root)              close the root's context and keep its artifacts
//   recover(root, reason)      optional: reopen the root after a crashed page; the walk continues

const REGION_ORDER = ['overlay', 'screen', 'nav', 'sidebar', 'chrome'];
const GLOBAL_REGIONS = new Set(['chrome', 'sidebar', 'nav']);

/** Stable order: overlay controls first, then the screen, then the shared chrome. */
export function orderControls(controls) {
  const rank = (region) => {
    const at = REGION_ORDER.indexOf(region);
    return at === -1 ? REGION_ORDER.length : at;
  };
  return controls
    .map((control, index) => ({ control, index }))
    .sort((a, b) => rank(a.control.region) - rank(b.control.region) || a.index - b.index)
    .map((item) => item.control);
}

/** One path step: region, name and occurrence identify a control on its screen. */
export function stepOf(control) {
  return { region: control.region, name: control.name, occurrence: control.occurrence };
}

/** The visited key for a control. Shared chrome is keyed once across the whole app. */
export function controlId({ rootId, path, control }) {
  const scope = GLOBAL_REGIONS.has(control.region) ? 'global' : rootId;
  const trail = path.map((step) => `${step.region}:${step.name}#${step.occurrence}`).join(' > ');
  return `${scope} | ${trail ? `${trail} > ` : ''}${control.region}:${control.name}#${control.occurrence}`;
}

/** Keeps the visited set, the node records and the navigation edges. */
export class VisitedGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.overlayStates = new Map();
  }

  has(id) {
    return this.nodes.has(id);
  }

  add(node) {
    this.nodes.set(node.id, node);
    return node;
  }

  link(from, to, kind) {
    this.edges.push({ from, to, kind });
  }

  summary() {
    const counts = { pass: 0, flag: 0, 'dead-end': 0, skipped: 0, 'not-reached': 0 };
    for (const node of this.nodes.values()) counts[node.status] = (counts[node.status] || 0) + 1;
    const clicked = counts.pass + counts.flag + counts['dead-end'];
    const eligible = this.nodes.size - counts.skipped;
    return {
      controlsFound: this.nodes.size,
      skipped: counts.skipped,
      nodesReached: clicked,
      pass: counts.pass,
      flagged: counts.flag,
      deadEnds: counts['dead-end'],
      notReached: counts['not-reached'],
      coverage: eligible ? Math.round((clicked / eligible) * 1000) / 10 : 100,
      overlayLinks: this.edges.filter((edge) => edge.kind === 'same-overlay').length,
      navigationEdges: this.edges.filter((edge) => edge.kind === 'navigate').length,
    };
  }
}

/**
 * Walks every root. Options: maxDepth (overlay nesting), deadlineMs (wall clock), onNode(node) for
 * incremental writes. Returns the graph. Controls not reached before the deadline stay not-reached.
 */
export async function traverse({ roots, adapter, graph = new VisitedGraph(), maxDepth = 4, deadlineMs = Infinity, now = Date.now, onNode = () => {} }) {
  const expired = () => now() > deadlineMs;
  const rec = (node) => { graph.add(node); onNode(node); return node; };

  /**
   * A crashed page is recovered by reopening the root. Returns false when the reopen itself throws,
   * so the walk records a second crash and goes on with the next control.
   */
  async function recoverFrom(node, error) {
    if (!adapter.recover) return false;
    try {
      await adapter.recover(node.root, String(error && error.message ? error.message : error));
      return true;
    } catch {
      return false;
    }
  }

  async function restoreBase(node) {
    try {
      if ((await adapter.signature()) !== node.signature) await adapter.replay(node.root, node.path);
    } catch (error) {
      await recoverFrom(node, error);
    }
  }

  async function exploreControl(node, control) {
    const id = controlId({ rootId: node.root.id, path: node.path, control });
    if (graph.has(id)) return;
    const entry = rec({ id, root: node.root.id, route: node.root.route, path: node.path.map((s) => `${s.region}:${s.name}#${s.occurrence}`), label: control.name, region: control.region, status: 'not-reached', problems: [] });
    const reason = adapter.skipReason(control) || (control.selected ? 'already-selected' : null);
    if (reason) return Object.assign(entry, { status: 'skipped', reason });
    await restoreBase(node);
    let obs;
    try {
      obs = await adapter.act(control);
    } catch (error) {
      const recovered = await recoverFrom(node, error);
      return Object.assign(entry, { status: 'flag', problems: recovered ? ['browser-crash'] : ['browser-crash', 'recover-failed'] });
    }
    Object.assign(entry, { observation: obs, problems: obs.problems, status: obs.dead ? 'dead-end' : obs.problems.length ? 'flag' : 'pass' });
    if (obs.navigated) graph.link(id, `route:${obs.route}`, 'navigate');
    if (obs.opensOverlay) await descend(node, control, id, entry);
    await restoreBase(node);
  }

  async function descend(node, control, id, entry) {
    const state = await adapter.overlayState();
    if (!state) return;
    if (graph.overlayStates.has(state)) {
      graph.link(id, graph.overlayStates.get(state), 'same-overlay');
      entry.linkedTo = graph.overlayStates.get(state);
      return;
    }
    graph.overlayStates.set(state, id);
    if (node.depth + 1 > maxDepth) { entry.depthCapped = true; return; }
    const child = { root: node.root, path: [...node.path, stepOf(control)], depth: node.depth + 1, signature: await adapter.signature(), overlayOpen: true };
    await exploreScreen(child);
    const trapped = await adapter.escape();
    if (trapped) {
      entry.status = entry.status === 'pass' ? 'flag' : entry.status;
      entry.problems = [...new Set([...entry.problems, 'no-way-back'])];
    }
  }

  async function exploreScreen(node) {
    const controls = orderControls(await adapter.listControls(node.overlayOpen));
    for (const control of controls) {
      if (expired()) return;
      await exploreControl(node, control);
    }
  }

  for (const root of roots) {
    if (expired()) break;
    await adapter.beginRoot(root);
    const base = { root, path: [], depth: 0, overlayOpen: false, signature: await adapter.signature() };
    await exploreScreen(base);
    await adapter.endRoot(root);
  }
  return graph;
}
