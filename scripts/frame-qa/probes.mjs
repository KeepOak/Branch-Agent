// In-page probes. Each function is serialised with toString() and run in the window, so it must not
// reference anything from Node. Timestamps are epoch milliseconds, the same clock as Date.now().

/** Installed before the app loads. Records input times, layout shifts, scroll jumps and DOM mutations. */
export function installProbes() {
  const now = () => performance.timeOrigin + performance.now();
  const qa = {
    lastInput: 0,
    shifts: [],
    jumps: [],
    mutations: [],
    rejections: [],
    reset() {
      qa.shifts.length = 0;
      qa.jumps.length = 0;
      qa.mutations.length = 0;
    },
  };
  window.__qa = qa;
  window.addEventListener('unhandledrejection', (event) => {
    qa.rejections.push(String(event.reason && (event.reason.stack || event.reason.message || event.reason)).slice(0, 300));
  });
  const describe = (el) => {
    if (!el || !el.tagName) return '';
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    const testid = el.getAttribute ? el.getAttribute('data-testid') : '';
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${testid ? `[testid=${testid}]` : ''}`.slice(0, 120);
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, () => { qa.lastInput = now(); }, { capture: true, passive: true });
  }
  if ('PerformanceObserver' in window) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        qa.shifts.push({ t: now(), value: entry.value, hadRecentInput: entry.hadRecentInput, node: describe(entry.sources?.[0]?.node) });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  }
  const scrollers = new Map();
  const rescan = () => {
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const scrolls = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
      if (scrolls && !scrollers.has(el) && scrollers.size < 120) scrollers.set(el, el.scrollTop);
    }
  };
  setInterval(rescan, 500);
  const frame = () => {
    const t = now();
    for (const [el, last] of scrollers) {
      if (!el.isConnected) { scrollers.delete(el); continue; }
      const top = el.scrollTop;
      if (top !== last) {
        if (Math.abs(top - last) >= 30 && t - qa.lastInput > 200) qa.jumps.push({ t, el: describe(el), from: last, to: top });
        scrollers.set(el, top);
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const observer = new MutationObserver((records) => {
    const t = now();
    for (const record of records.slice(0, 50)) {
      if (qa.mutations.length < 5000) qa.mutations.push({ t, target: describe(record.target) });
    }
  });
  const start = () => observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });
}

/** Text that is clipped by its box, with the full text it hides. */
export function scanClipped() {
  const roots = [document.querySelector('#main'), document.querySelector('[data-testid="sidebar"]'),
    ...document.querySelectorAll('[role="dialog"], [role="menu"]')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('*')) {
      const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
      if (!own || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      const overflows = el.scrollWidth > el.clientWidth + 1;
      if (overflows && cs.overflowX !== 'visible') {
        out.push({ text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200), ellipsis: cs.textOverflow === 'ellipsis' });
        if (out.length >= 80) return out;
      }
    }
  }
  return out;
}

/** Text colour, effective background, size and opacity for every text-bearing element in view. */
export function scanContrast() {
  const roots = [document.querySelector('#main'), document.querySelector('[data-testid="sidebar"]'),
    ...document.querySelectorAll('[role="dialog"], [role="menu"]')].filter(Boolean);
  const bgOf = (el) => {
    for (let node = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && !/rgba\(.*,\s*0\)$|transparent/.test(bg)) return bg;
    }
    return getComputedStyle(document.body).backgroundColor || 'rgb(255, 255, 255)';
  };
  const opacityOf = (el) => {
    let value = 1;
    for (let node = el; node; node = node.parentElement) value *= Number(getComputedStyle(node).opacity) || 1;
    return value;
  };
  const out = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('*')) {
      const text = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join(' ').trim();
      if (!text || !el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      out.push({
        text: text.slice(0, 80),
        color: cs.color,
        background: bgOf(el),
        fontSizePx: Number.parseFloat(cs.fontSize),
        fontWeight: Number(cs.fontWeight),
        opacity: opacityOf(el),
        disabled: Boolean(el.closest('[disabled], [aria-disabled="true"]')),
      });
      if (out.length >= 400) return out;
    }
  }
  return out;
}

/** Tags every visible scrollable element with data-qa-scroll and returns its index and size. */
export function tagScrollables() {
  for (const old of document.querySelectorAll('[data-qa-scroll]')) old.removeAttribute('data-qa-scroll');
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY) || el.scrollHeight <= el.clientHeight + 4) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const index = out.length;
    el.setAttribute('data-qa-scroll', String(index));
    out.push({ index, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    if (out.length >= 30) break;
  }
  return out;
}

/** Describes the focused element, or the body when nothing has focus. */
export function describeActive() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return 'body';
  const name = el.getAttribute('aria-label') || (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return `${el.tagName.toLowerCase()}:${name || el.getAttribute('data-testid') || ''}`;
}

/** Bounding box and the element found at the centre point, for click-interception checks. */
export function clickPoint() {
  const target = document.querySelector('[data-crawl-target]');
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const reached = Boolean(hit && (hit === target || target.contains(hit)));
  const hitName = hit ? (hit.getAttribute('aria-label') || (hit.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)) : '';
  return { x, y, width: rect.width, height: rect.height, reached, hit: hit ? `${hit.tagName.toLowerCase()}:${hitName}` : '' };
}
