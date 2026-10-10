// Test fixture for the button crawl. The shipped window loads App.tsx instead.
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Contact } from '@branch/gateway-protocol';
import { historyToBlocks } from '../src/thread/history';
import { WindowShell } from '../src/shell/WindowShell';
import { dismiss, getToasts } from '../src/shell/notify';
import { PLACES, type Route } from '../src/places-nav/routes';
import { settingsGroups } from '../src/places-nav/settings-nav';
import '../src/theme/tokens.css';
import '../src/theme/base.css';
import '../src/shell/shell.css';
import '../src/shell/frame.css';
import '../src/shell/controls.css';

type Call = { method: string; ok: boolean; error?: string };

const now = Date.now();
const contact = (id: string, kind: 'trunk' | 'outside', name: string, threadKey: string, isDefault = false): Contact => ({
  id, kind, name, threadKey, isDefault, lastActivityAt: now,
  preview: { kind: 'message', text: 'Three open questions remain.', at: now },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
} as Contact);

const CONTACTS: Contact[] = [
  contact('trunk:researcher', 'trunk', 'Researcher', 'agent:researcher:notes', true),
  contact('trunk:builder', 'trunk', 'Builder', 'agent:builder:roadmap'),
  contact('a2a:studio', 'outside', 'Studio computer', 'agent:planner:design'),
];

const SESSIONS = [
  { key: 'agent:researcher:notes', label: 'Researcher', agentId: 'researcher', sessionId: 'sess-researcher', updatedAt: now, createdAt: now - 1000, isMain: true, lastMessagePreview: 'Three open questions remain.', hasActiveRun: false, kind: 'direct' },
  { key: 'agent:builder:roadmap', label: 'Builder', agentId: 'builder', sessionId: 'sess-builder', updatedAt: now - 60000, createdAt: now - 60000, lastMessagePreview: 'The next slice is the sidebar.', hasActiveRun: false, kind: 'direct' },
  { key: 'agent:planner:design', label: 'Studio computer', agentId: 'planner', sessionId: 'sess-planner', updatedAt: now - 120000, createdAt: now - 120000, lastMessagePreview: 'The preview is open.', hasActiveRun: false, kind: 'direct' },
];

const MESSAGES: Record<string, { role: string; content: string; timestamp: number }[]> = {
  'agent:researcher:notes': [
    { role: 'user', content: 'Summarize the customer interviews.', timestamp: now - 2000 },
    { role: 'assistant', content: 'Three open questions remain.', timestamp: now - 1000 },
  ],
  'agent:builder:roadmap': [
    { role: 'user', content: 'What is the next slice?', timestamp: now - 70000 },
    { role: 'assistant', content: 'The next slice is the sidebar.', timestamp: now - 60000 },
  ],
  'agent:planner:design': [
    { role: 'user', content: 'Open the preview.', timestamp: now - 130000 },
    { role: 'assistant', content: 'The preview is open.', timestamp: now - 120000 },
  ],
};

const AGENTS = {
  defaultId: 'researcher',
  agents: [
    { id: 'researcher', identity: { name: 'Researcher' } },
    { id: 'builder', identity: { name: 'Builder' } },
    { id: 'planner', identity: { name: 'Planner' } },
  ],
};

const SELECTOR = [
  'button', 'a[href]', '[role="button"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  '[role="tab"]', '[role="switch"]', 'input[type="checkbox"]', '.chip', '.ib',
].join(',');

let config = { hash: 'fixture', config: { wizard: { lastRunAt: '2026-10-01T00:00:00Z' }, agents: { defaults: { model: { primary: 'local/fixture' } } } } };
let historyMoves = 0;
const historyBack = history.back.bind(history);
const historyForward = history.forward.bind(history);
history.back = () => { historyMoves += 1; historyBack(); };
history.forward = () => { historyMoves += 1; historyForward(); };
const calls: Call[] = [];
const listeners = new Set<() => void>();
const events = new Set<(event: string, payload: unknown) => void>();
let root: Root | null = null;
let nonce = 0;
let marked: { name: string; occurrence: number; region: string } | null = null;
let markedEl: Element | null = null;
let cachedEngine: { sessionKey: string; request: typeof request } | null = null;
let snap = snapshot('agent:researcher:notes');

function snapshot(key: string) {
  const row = SESSIONS.find((session) => session.key === key) ?? SESSIONS[0];
  return {
    status: { phase: 'connected', hello: { server: { version: '0.19.4' } } },
    sessionKey: key,
    mainKey: SESSIONS[0].key,
    name: row.label,
    history: historyToBlocks(MESSAGES[key] ?? [], [], key, null),
    live: [],
    pendingUser: null,
    liveRunId: null,
    doneAt: null,
    error: null,
  };
}

function mergeConfig(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete out[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = mergeConfig(out[key], value);
    else out[key] = value;
  }
  return out;
}

let prefs: { status: string; entries: Record<string, unknown> } = { status: 'ok', entries: {} };

function request(method: string, params: { key?: string; sessionKey?: string; raw?: string; entries?: Record<string, unknown> } | undefined) {
  const started = performance.now();
  try {
    const result = respond(method, params);
    calls.push({ method, ok: true });
    return Promise.resolve(result);
  } catch (error) {
    calls.push({ method, ok: false, error: error instanceof Error ? error.message : String(error) });
    return Promise.reject(error);
  } finally {
    void started;
  }
}

function respond(method: string, params: { key?: string; sessionKey?: string; raw?: string; entries?: Record<string, unknown> } | undefined) {
  if (method === 'agents.list') return AGENTS;
  if (method === 'sessions.subscribe') return { list: { sessions: SESSIONS } };
  if (method === 'sessions.list') return { sessions: SESSIONS, defaults: { modelProvider: 'local', model: 'fixture', thinkingLevel: 'medium' } };
  if (method === 'sessions.describe') {
    const row = SESSIONS.find((session) => session.key === params?.key) ?? SESSIONS[0];
    return { session: row };
  }
  if (method === 'chat.history') {
    const key = params?.sessionKey ?? snap.sessionKey;
    return { messages: MESSAGES[key] ?? [], sessionId: `sess-${key}` };
  }
  if (method === 'contacts.list') return { contacts: CONTACTS };
  if (method === 'contacts.topics') return { topics: [] };
  if (method === 'rooms.list') return { rooms: [] };
  if (method === 'a2a.peers.list') return { peers: [] };
  if (method === 'config.get') return config;
  if (method === 'config.patch') {
    const patch = JSON.parse(params?.raw || '{}') as unknown;
    config = { ...config, hash: `${config.hash}x`, config: mergeConfig(config.config, patch) as typeof config.config };
    return { ok: true, hash: config.hash, config: config.config };
  }
  if (method === 'users.prefs.get') return prefs;
  if (method === 'users.prefs.set') {
    const entries = { ...prefs.entries };
    for (const [key, value] of Object.entries(params?.entries || {})) {
      if (value === null) delete entries[key];
      else entries[key] = value;
    }
    prefs = { status: 'ok', entries };
    return { status: 'ok' };
  }
  if (method === 'models.list') return { models: [{ id: 'fixture', provider: 'local', name: 'Local model', contextWindow: 32768 }] };
  if (method === 'system.info') return { machineName: 'This computer' };
  if (method === 'health') return { ok: true, durationMs: 4 };
  if (method === 'usage.status') return {};
  if (method === 'exec.approval.list' || method === 'plugin.approval.list' || method === 'branch.approval.list') return [];
  if (method === 'commands.list') return { commands: [] };
  if (method === 'skills.status') return { skills: [] };
  if (method === 'users.mentionable') return { users: [] };
  if (method === 'sessions.preview') return { previews: [] };
  if (method === 'sessions.search') return { results: [] };
  return { ok: true, items: [], sessions: [], contacts: [], rooms: [], peers: [], models: [], messages: [], results: [] };
}

const fixture = {
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => snap,
  onGatewayEvent(fn: (event: string, payload: unknown) => void) { events.add(fn); return () => events.delete(fn); },
  request,
  open: async (key: string) => { snap = snapshot(key); listeners.forEach((fn) => fn()); },
  reload: async () => undefined,
  send: async (text: string) => {
    snap = { ...snap, history: [...snap.history, { kind: 'user', key: `local-${snap.history.length}`, text }] };
    listeners.forEach((fn) => fn());
  },
  stopRun: async () => { snap = { ...snap, liveRunId: null }; listeners.forEach((fn) => fn()); },
  answer: async () => undefined,
  get engine() {
    if (cachedEngine?.sessionKey === snap.sessionKey) return cachedEngine;
    cachedEngine = { sessionKey: snap.sessionKey, request };
    return Object.assign(cachedEngine, {
      agentId: snap.sessionKey.split(':')[1],
      scopes: ['operator.admin'],
      attachmentPolicy: { maxBytes: 10_000_000 },
      onEvent: (fn: (event: string, payload: unknown) => void) => { events.add(fn); return () => events.delete(fn); },
    });
  },
};

function visible(el: Element) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest('[hidden], [inert]')) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function nameOf(el: Element) {
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim().slice(0, 80);
  const mirror = el.classList.contains('mirror') ? el.querySelector(':scope > b') : null;
  const mirrorName = mirror?.textContent?.replace(/\s+/g, ' ').trim();
  if (mirrorName) return mirrorName.slice(0, 80);
  const rowName = el.querySelector('.nm-t')?.textContent?.replace(/\s+/g, ' ').trim();
  if (rowName) return rowName.slice(0, 80);
  const text = ((el instanceof HTMLElement ? el.innerText : el.textContent) || '').replace(/\s+/g, ' ').trim();
  return (text || el.getAttribute('title') || el.getAttribute('data-testid') || el.tagName).slice(0, 80);
}

function regionOf(el: Element) {
  if (el.closest('[role="menu"], [role="dialog"]')) return 'overlay';
  if (el.closest('.set-nav')) return 'nav';
  if (el.closest('.topbar') || el.closest('a.skip')) return 'chrome';
  if (el.closest('[data-testid="sidebar"]')) return 'sidebar';
  if (el.closest('#main')) return 'screen';
  return 'ignored';
}

function regionRoot(region: string) {
  if (region === 'overlay') return document.querySelector('[role="menu"], [role="dialog"]');
  if (region === 'nav') return document.querySelector('.set-nav');
  if (region === 'sidebar') return document.querySelector('[data-testid="sidebar"]');
  if (region === 'screen') return document.querySelector('#main');
  return document;
}

function findMarked() {
  if (!marked) return null;
  const root = regionRoot(marked.region);
  if (!root) return null;
  let seen = 0;
  for (const el of root.querySelectorAll(SELECTOR)) {
    if (!visible(el) || regionOf(el) !== marked.region || nameOf(el) !== marked.name) continue;
    if (seen === marked.occurrence) return el;
    seen += 1;
  }
  return null;
}

function collect(overlay = false) {
  const root = overlay ? document.querySelector('[role="menu"], [role="dialog"]') : document;
  if (!root) return [];
  const seen = new Map<string, number>();
  const elements: { name: string; href: string; disabled: boolean; selected: boolean; occurrence: number; region: string }[] = [];
  for (const el of root.querySelectorAll(SELECTOR)) {
    if (!visible(el)) continue;
    const region = regionOf(el);
    if (region === 'ignored') continue;
    if (overlay ? region !== 'overlay' : region === 'overlay') continue;
    const name = nameOf(el);
    const key = `${region}\0${name}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const control = el as HTMLButtonElement;
    elements.push({
      name,
      href: el instanceof HTMLAnchorElement ? el.href : '',
      disabled: control.disabled === true || el.getAttribute('aria-disabled') === 'true',
      selected: Boolean(el.closest('.sseg') && (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true')),
      occurrence,
      region,
    });
  }
  return elements;
}

function mark(name: string, occurrence: number, region = 'screen') {
  document.querySelectorAll('[data-crawl-target]').forEach((el) => el.removeAttribute('data-crawl-target'));
  marked = { name, occurrence, region };
  const el = findMarked();
  markedEl = el;
  if (!(el instanceof HTMLElement)) return false;
  el.setAttribute('data-crawl-target', '1');
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}

function clickTarget() {
  const el = document.querySelector('[data-crawl-target]');
  if (!(el instanceof HTMLElement)) return false;
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true }));
  }
  el.click();
  return true;
}

function readRoute() {
  try { return JSON.parse(localStorage.getItem('branch.route') || 'null') as Route | null; }
  catch { return null; }
}

function routeId(route: Route | null) {
  if (!route) return '';
  if (route.kind === 'chat') return `chat:${route.key ?? ''}`;
  if (route.kind === 'place') return `place:${route.place}`;
  return `settings:${route.page}`;
}

function rowCardOpen() {
  const card = document.querySelector('.row-card');
  if (!(card instanceof HTMLElement)) return false;
  const style = getComputedStyle(card);
  return style.visibility !== 'hidden' && style.display !== 'none' && card.getClientRects().length > 0;
}

function textOf(node: Element | null) {
  if (!node) return '';
  const copy = node.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[role="menu"], [role="dialog"], .toast, .toasts').forEach((el) => el.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

function screenText() {
  const main = document.querySelector('#main .set-col') ?? document.querySelector('#main') ?? document.body;
  return textOf(main).slice(0, 4000);
}

function viewText() {
  const main = document.querySelector('#main .set-col') ?? document.querySelector('#main');
  const side = document.querySelector('[data-testid="sidebar"]');
  return [textOf(main), textOf(side)].filter(Boolean).join(' ').slice(0, 8000);
}

function controlState(el: Element) {
  const pressed = el.getAttribute('aria-pressed');
  const checked = el.getAttribute('aria-checked');
  const input = el instanceof HTMLInputElement ? String(el.checked) : '';
  return [pressed, checked, input].join('|');
}

function surface() {
  const dialog = document.querySelector('[role="dialog"]');
  const menu = document.querySelector('[role="menu"]');
  const toast = document.querySelector('.toast');
  const alert = [...document.querySelectorAll('[role="alert"]')].find((el) => !el.closest('.toast, .toasts'));
  const target = markedEl && markedEl.isConnected ? markedEl : findMarked();
  const mainText = screenText();
  const menuItems = [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')]
    .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    route: routeId(readRoute()),
    dialog: dialog instanceof HTMLElement ? (dialog.getAttribute('aria-label') || dialog.textContent || 'dialog').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
    menu: menu instanceof HTMLElement ? (menu.getAttribute('aria-label') || 'menu') : null,
    panel: document.querySelector('.side-pane, .panel') instanceof HTMLElement ? 'panel' : null,
    toast: toast instanceof HTMLElement ? toast.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || null : null,
    mainText,
    viewText: viewText(),
    alert: alert instanceof HTMLElement ? alert.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) || '' : '',
    unimplemented: /\b(coming soon|not implemented|not yet implemented|placeholder)\b/i.test(mainText),
    blank: mainText.length < 12,
    control: target instanceof HTMLElement ? controlState(target) : '',
    focus: document.activeElement instanceof HTMLElement
      && document.activeElement !== target
      && document.activeElement !== document.body
      && document.activeElement !== document.documentElement
      ? nameOf(document.activeElement)
      : '',
    hash: location.hash,
    chrome: document.documentElement.getAttribute('data-theme') || '',
    historyMoves,
    alreadyCurrent: target?.getAttribute('aria-current') === 'true',
    menuItems,
    requests: calls.slice(),
    requestCount: calls.length,
    rowCard: rowCardOpen(),
  };
}

function rowActions() {
  return [...document.querySelectorAll('[data-testid="conversation-row"]')].flatMap((row) => {
    if (row.closest('.kids-box')) return [];
    const label = row.querySelector('.nm-t')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const actions = [...row.querySelectorAll('.row-acts button')].map((button) => button.getAttribute('aria-label') || button.getAttribute('title') || '');
    return [{ label, key: row.getAttribute('data-key') || '', actions }];
  });
}

function listLabels() {
  return [...document.querySelectorAll('.nm-t, .pin-name')].map((el) => el.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean);
}

function openKind(key: string) {
  const route = readRoute();
  const onThread = route?.kind === 'chat' && route.key === key;
  const main = document.querySelector('.v23-main, .main');
  const full = Boolean(onThread && main instanceof HTMLElement && (main.textContent || '').trim().length > 20);
  if (full) return 'full';
  if (rowCardOpen()) return 'popover';
  return 'popover';
}

function mount(route: Route) {
  localStorage.setItem('branch.route', JSON.stringify(route));
  localStorage.setItem('branch.level', 'technical');
  localStorage.setItem('branch.theme', 'light');
  for (const toast of getToasts()) dismiss(toast.id);
  calls.length = 0;
  cachedEngine = null;
  marked = null;
  markedEl = null;
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  historyMoves = 0;
  const key = route.kind === 'chat' && route.key ? route.key : SESSIONS[0].key;
  snap = snapshot(key);
  nonce += 1;
  const host = document.getElementById('root');
  if (!host) return;
  root ??= createRoot(host);
  root.render(<WindowShell key={nonce} session={fixture as never} url="ws://127.0.0.1:9" />);
}

// Permission-style requests a control can start. A microphone or notification prompt answers
// later than the click, so the crawl waits for these to settle before it reads the result.
let pendingPermissionRequests = 0;
function trackPermissionRequest<T>(call: () => Promise<T>): Promise<T> {
  pendingPermissionRequests += 1;
  return call().finally(() => {
    pendingPermissionRequests -= 1;
  });
}
// The crawl has no microphone or camera. Each capture request resolves to a silent stream of the kind it
// asked for, so a voice note really starts recording and the crawl observes that state.
function fakeCapture(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (constraints.video) {
    return Promise.resolve(document.createElement("canvas").captureStream());
  }
  return Promise.resolve(new AudioContext().createMediaStreamDestination().stream);
}
if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) =>
    trackPermissionRequest(() => fakeCapture(constraints));
}
if (typeof Notification !== 'undefined') {
  const nativeRequestPermission = Notification.requestPermission.bind(Notification);
  Notification.requestPermission = (...args: Parameters<typeof Notification.requestPermission>) =>
    trackPermissionRequest(() => nativeRequestPermission(...args));
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('api.github.com/')) {
    return Promise.resolve(new Response(JSON.stringify({ tag_name: 'v0.0.0', assets: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }
  return nativeFetch(input, init);
};

(window as unknown as { __crawl: Record<string, unknown> }).__crawl = {
  mount,
  catalog() {
    return {
      sessions: SESSIONS.map((session) => ({ key: session.key, title: session.label })),
      places: PLACES.map((place) => place.id),
      settings: settingsGroups('technical').flatMap((group) => group.pages.map((page) => page.id)),
    };
  },
  collect, mark, clickTarget, surface, rowActions, listLabels, openKind,
  pendingPermissionRequests: () => pendingPermissionRequests,
};

mount({ kind: 'chat', key: SESSIONS[0].key });
