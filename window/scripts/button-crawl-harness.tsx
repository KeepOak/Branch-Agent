// Test fixture for the button crawl. The shipped window loads App.tsx instead.
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Contact } from '@branch/gateway-protocol';
import { historyToBlocks } from '../src/thread/history';
import { WindowShell } from '../src/shell/WindowShell';
import { R1Window, SETTINGS_PLACE } from '../src/screens/frame/R1Window';
import { PAGES as R1_PAGES_SPEC, pageShown, type PageId, type Level } from '../src/screens/settings/nav';
import { dismiss, getToasts } from '../src/shell/notify';
import { PLACES, type Route } from '../src/places-nav/routes';
import { settingsGroups } from '../src/places-nav/settings-nav';
import '../src/theme/tokens.css';
import '../src/theme/base.css';
import '../src/shell/shell.css';
import '../src/shell/frame.css';
import '../src/shell/controls.css';
import { createCrawlCapture } from './button-crawl-capture';
import { applyApprovalsSet, applyConfigPatch, applyPrefsSet, applyVoiceToggle, freshApprovals, freshConfig, freshPrefs, freshVoice, voiceProviders, voiceStatus, type CrawlApprovals, type CrawlConfig, type CrawlPrefs, type CrawlVoice } from './button-crawl-state';

type Call = { method: string; ok: boolean; error?: string };
// The request params the mock reads. Path and method are the browser route's (browser-request.ts:567).
type CrawlParams = { key?: string; sessionKey?: string; raw?: string; entries?: Record<string, unknown>; file?: Record<string, unknown>; baseHash?: string; provider?: string; probe?: boolean; method?: string; path?: string };
// The window under test. The shipped app opens R1 (R1Window) unless the Classic escape is set, so R1 is the default
// and Classic is crawled only with ?window=classic (see crawl.mjs BUTTON_CRAWL_WINDOW).
const WINDOW_KIND: 'r1' | 'classic' = new URLSearchParams(location.search).get('window') === 'classic' ? 'classic' : 'r1';
// The level a Settings screen is drawn at: the look store's word for it (branch.level in this window's storage).
export type LevelWord = 'regular' | 'advanced' | 'technical';
const LEVEL_OF: Record<LevelWord, Level> = { regular: 0, advanced: 1, technical: 2 };

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

// A grafted agent's row opens its contact key (a2a:<peer>), not a session (see screens/frame/open-name.ts).
const GRAFTED_KEY = 'a2a:studio';

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

// Every R1 Settings page at each level it is shown at. A page that is a place (Customize, Automations, Memory &
// documents) opens that place, so the place screens cover it and it is not repeated here.
const LEVEL_WORD_LIST: LevelWord[] = ['regular', 'advanced', 'technical'];
function r1SettingsScreens() {
  return Object.keys(R1_PAGES_SPEC)
    .filter((page) => !(page in SETTINGS_PLACE))
    .flatMap((page) => LEVEL_WORD_LIST
      .filter((word) => pageShown(page as PageId, LEVEL_OF[word]))
      .map((word) => ({ page, level: word })));
}

function classicSettingsScreens() {
  return settingsGroups('technical').flatMap((group) => group.pages.map((page) => ({ page: page.id, level: 'technical' as LevelWord })));
}

let config: CrawlConfig = freshConfig();
let historyMoves = 0;
// A control that opens a window (Open in its own window) is a visible result: the browser fallback calls window.open.
let popups = 0;
window.open = (() => { popups += 1; return null; }) as typeof window.open;
// A control that saves a file (Export) is a visible result too. The download is cancelled, and the click counted.
let downloads = 0;
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest?.('a[download]');
  if (!link) return;
  downloads += 1;
  event.preventDefault();
}, true);
// A detached anchor that a control clicks to save a file (a seed, an export) never reaches the listener above, so the
// click is counted here: the download is cancelled and the click is a visible result.
const nativeAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function clickWithoutSaving(this: HTMLAnchorElement) {
  if (this.hasAttribute('download')) { downloads += 1; return; }
  nativeAnchorClick.call(this);
};
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

let prefs: CrawlPrefs = freshPrefs();
// Whether the browser the stage drives is running. "Start the browser" flips it, as the engine does.
let browserRunning = false;
let approvals: CrawlApprovals = freshApprovals();
let voice: CrawlVoice = freshVoice();

function request(method: string, params: CrawlParams | undefined) {
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

function respond(method: string, params: CrawlParams | undefined) {
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
    config = applyConfigPatch(config, params?.raw || '{}');
    return { ok: true, hash: config.hash, config: config.config };
  }
  if (method === 'tts.status') return voiceStatus(voice);
  if (method === 'tts.enable' || method === 'tts.disable') { voice = applyVoiceToggle(voice, method === 'tts.enable'); return { enabled: voice.auto !== 'off' }; }
  if (method === 'tts.providers') return voiceProviders(voice);
  if (method === 'tts.setProvider') { voice = { ...voice, provider: String(params?.provider ?? voice.provider) }; return { provider: voice.provider }; }
  // The engine's memory probe (gateway doctor.ts) answers with the embedding check; a plain status read has none yet.
  if (method === 'doctor.memory.status' && (params as { probe?: boolean } | undefined)?.probe) return { agentId: 'main', searchRuntimeRegistered: true, embedding: { ok: true, checked: true } };
  if (method === 'exec.approvals.get') return approvals;
  if (method === 'exec.approvals.set') {
    approvals = applyApprovalsSet(approvals, params as { file?: Record<string, unknown>; baseHash?: string } ?? {});
    return approvals;
  }
  if (method === 'users.prefs.get') return prefs;
  if (method === 'users.prefs.set') {
    prefs = applyPrefsSet(prefs, params?.entries || {});
    return { status: 'ok' };
  }
  if (method === 'models.list') return { models: [{ id: 'fixture', provider: 'local', name: 'Local model', contextWindow: 32768 }] };
  if (method === 'system.info') return { machineName: 'This computer' };
  if (method === 'health') return { ok: true, durationMs: 4 };
  // Replies for the methods R1 calls. Each cites the engine handler that answers it, so a control reads the fields it
  // reads on a real engine.
  if (method === 'browser.request' && params?.method === 'POST' && params?.path === '/start') {
    browserRunning = true;
    return { ok: true, running: true }; // browser-request.ts:567 route map
  }
  if (method === 'usage.status') return { updatedAt: now, refreshing: false, providers: [] }; // usage.ts:189
  if (method === 'computer.status') return { available: false, configured: false }; // computer.ts:79
  if (method === 'browser.request') return { running: browserRunning, detectedBrowser: null, detectedExecutablePath: null, detectError: null }; // browser-request.ts:567, basic.ts:211-224
  if (method === 'node.list') return { ts: now, activeNodeId: null, nodes: [] }; // nodes.read.ts:226
  if (method === 'memory.export') return { agentId: 'researcher', files: [{ path: 'MEMORY.md', content: '# Memory\n' }] }; // memory-export.ts:69
  if (method === 'sessions.diff') return { sessionKey: params?.sessionKey ?? snap.sessionKey, files: [], additions: 0, deletions: 0, unavailableReason: 'unknown_session' }; // sessions-diff.ts:24-31
  if (method === 'gateway.restart.request') return { status: 'scheduled' }; // restart-coordinator.ts:57
  if (method === 'sessions.branches.list') return { branches: [] }; // sessions-rewind.ts:199
  if (method === 'portal.list') return { portals: [] }; // portals.ts:119-125
  if (method === 'progressCard.get') return { card: null }; // progress-card.ts:102
  if (method === 'rooms.list') return { rooms: [] }; // rooms.ts:495
  if (method === 'models.authStatus') return { providers: [], profiles: [] }; // models-auth-status.ts:301
  if (method === 'plugins.catalog.browse') return { items: [], catalog: {}, local: {} }; // plugins.ts:242, seedbank/catalog.ts:75-90
  if (method === 'branch.setup.detect') return { candidates: [], unavailableCandidates: [], setupComplete: false }; // setup-inference-detect.ts:448-454
  if (method === 'agents.create') return { ok: true, agentId: 'new-trunk' }; // agents.ts:646
  if (method === 'sessions.create') return { ok: true, key: SESSIONS[0].key, sessionId: 'sess-researcher', entry: {}, runStarted: false }; // sessions-create.ts:633-640
  if (method === 'exec.approval.list' || method === 'plugin.approval.list' || method === 'branch.approval.list') return [];
  if (method === 'commands.list') return { commands: [] };
  if (method === 'skills.status') return { skills: [] };
  if (method === 'users.mentionable') return { users: [] };
  if (method === 'sessions.preview') return { previews: [] };
  if (method === 'sessions.search') return { results: [] };
  return { ok: true, items: [], sessions: [], contacts: [], rooms: [], peers: [], models: [], messages: [], results: [] };
}

// The methods the engine advertises by default. The engine sends its core list at connect (engine connect-hello.ts:171-174,
// core list from core-descriptors.ts). A method missing here reads as unavailable, so its control draws as Coming and the
// crawl never clicks it. canopy.cards.list is left out on purpose: Canopy is off by default, so its controls stay Coming.
const ADVERTISED_METHODS = [
  'agents.list', 'sessions.list', 'sessions.describe', 'sessions.subscribe', 'sessions.preview', 'sessions.search',
  'sessions.branches.list', 'sessions.diff', 'chat.history', 'contacts.list', 'contacts.topics', 'rooms.list', 'a2a.peers.list',
  'config.get', 'config.patch', 'tts.status', 'tts.enable', 'tts.disable', 'tts.providers', 'tts.setProvider',
  'doctor.memory.status', 'exec.approvals.get', 'exec.approvals.set', 'exec.approval.list', 'plugin.approval.list',
  'users.prefs.get', 'users.prefs.set', 'models.list', 'models.authStatus', 'system.info', 'health', 'usage.status',
  'commands.list', 'skills.status', 'users.mentionable', 'computer.status', 'browser.request', 'node.list', 'memory.export',
  'gateway.restart.request', 'portal.list', 'progressCard.get', 'plugins.catalog.browse', 'branch.setup.detect',
];

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
      features: { methods: ADVERTISED_METHODS },
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

// R1 regions: the Settings page list (r1s-side), the header (r1-header), the sidebar (r1-sidebar), and everything else
// in the frame (the conversation or Settings page, the composer, the side panel, the Computer and Browser stage).
function r1RegionOf(el: Element) {
  if (el.closest('.r1s-side')) return 'nav';
  if (el.closest('.r1-header') || el.closest('a.skip')) return 'chrome';
  if (el.closest('.r1-sidebar')) return 'sidebar';
  if (el.closest('.r1-frame')) return 'screen';
  return 'ignored';
}

function regionOf(el: Element) {
  if (el.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')) return 'overlay';
  if (WINDOW_KIND === 'r1') return r1RegionOf(el);
  if (el.closest('.set-nav')) return 'nav';
  if (el.closest('.topbar') || el.closest('a.skip')) return 'chrome';
  if (el.closest('[data-testid="sidebar"]')) return 'sidebar';
  if (el.closest('#main')) return 'screen';
  return 'ignored';
}

function regionRoot(region: string) {
  if (region === 'overlay') return document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]');
  if (region === 'nav') return document.querySelector(WINDOW_KIND === 'r1' ? '.r1s-side' : '.set-nav');
  if (region === 'sidebar') return sideElement();
  if (region === 'screen') return document.querySelector(WINDOW_KIND === 'r1' ? '.r1-frame' : '#main');
  return document;
}

/** The main column the text and scroll checks read: the conversation or Settings page in R1, #main in Classic. */
function mainElement(): Element | null {
  return document.querySelector(WINDOW_KIND === 'r1' ? '.r1-conversation' : '#main');
}

/** R1's side panel renders in its own slot beside the conversation, not inside it. */
function paneElement(): Element | null {
  return document.querySelector(WINDOW_KIND === 'r1' ? '.r1-pane-slot' : null);
}

function sideElement(): Element | null {
  return document.querySelector(WINDOW_KIND === 'r1' ? '.r1-sidebar' : '[data-testid="sidebar"]');
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
  const root = overlay ? document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"]') : document;
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
      // A tab, or a radio option that is already the chosen value, has nothing to change: clicking it is a no-op
      // by design, so the crawl skips it ("already-selected") instead of calling it dead.
      // A menu's radio choice that is already chosen (a scope, a sort) has nothing to change, like a tab that is open.
      selected: el.getAttribute('role') === 'menuitemradio' && el.getAttribute('aria-checked') === 'true'
        || el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') === 'true'
        || el.getAttribute('role') === 'radio' && el.getAttribute('aria-checked') === 'true'
        || el.getAttribute('aria-pressed') === 'true' && Boolean(el.closest('[role="group"], [role="radiogroup"]'))
        || Boolean(el.closest('.sseg') && (el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true')),
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
  copy.querySelectorAll('[role="menu"], [role="dialog"], [role="alertdialog"], .toast, .toasts').forEach((el) => el.remove());
  return (copy.textContent || '').replace(/\s+/g, ' ').trim();
}

function screenText() {
  const main = document.querySelector('#main .set-col') ?? mainElement() ?? document.body;
  return textOf(main).slice(0, 4000);
}

// The whole visible text, reduced to a length and a hash: a change anywhere on a long page is seen, not only in
// the first few thousand characters.
function digest(text: string) {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  return `${text.length}:${hash}`;
}

// The text of the open menu or dialog, and the values typed into the page's fields. A sub-view that swaps inside a
// menu, a popover that fills in a result, or a field a control fills in is a visible result too.
function overlayDigest() {
  const overlays = [...document.querySelectorAll<HTMLElement>('[role="menu"], [role="dialog"], [role="alertdialog"]')].filter(visible);
  return overlays.length ? digest(overlays.map(textOf).join(' | ')) : '';
}

function valuesDigest() {
  const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter(visible);
  return digest(fields.map((field) => `${field.name}|${field.placeholder}=${field.value}`).join('|'));
}

/** R1's frame layout: the sidebar's width state and which side panels are open. Collapsing the list changes it. */
function frameState() {
  const frame = document.querySelector('.r1-frame');
  if (!(frame instanceof HTMLElement)) return '';
  return ['wide', 'drawer', 'topics', 'pane'].map((name) => frame.getAttribute(`data-${name}`) ?? '').join('|');
}

function viewText() {
  const main = document.querySelector('#main .set-col') ?? mainElement();
  const side = sideElement();
  return digest([textOf(main), textOf(side), textOf(paneElement())].filter(Boolean).join(' '));
}

function controlState(el: Element) {
  const pressed = el.getAttribute('aria-pressed');
  const checked = el.getAttribute('aria-checked');
  const input = el instanceof HTMLInputElement ? String(el.checked) : '';
  return [pressed, checked, input].join('|');
}

// Scroll positions inside the main content only (the sidebar and the window itself are not measured). A scroll is a
// result only for an in-page jump (see surface): a control that scrolls the sidebar leaves this value unchanged.
function scrollOf() {
  const main = mainElement();
  if (!(main instanceof HTMLElement)) return '';
  return [main, ...main.querySelectorAll<HTMLElement>('*')]
    .filter((el) => el.scrollTop > 0)
    .map((el) => `${el.className || el.tagName}:${Math.round(el.scrollTop)}`)
    .join('|');
}

function surface() {
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
  const menu = document.querySelector('[role="menu"]');
  const toast = document.querySelector('.toast');
  const pane = paneElement();
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
    panel: pane instanceof HTMLElement && pane.childElementCount > 0 ? 'panel' : document.querySelector('.side-pane, .panel, .character-panel') instanceof HTMLElement ? 'panel' : null,
    toast: toast instanceof HTMLElement ? toast.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || null : null,
    mainText,
    viewText: viewText(),
    overlay: overlayDigest(),
    values: valuesDigest(),
    frame: frameState(),
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
    popups,
    downloads,
    // An in-page jump: a link to an anchor, or a button that scrolls to a section (data-jump-to).
    jump: Boolean(target?.closest('a[href^="#"], [data-jump-to]')),
    scroll: target?.closest('a[href^="#"], [data-jump-to]') ? scrollOf() : '',
    configRevision: config.hash,
    // aria-current marks the page or item already shown ("page" in R1's Settings nav, "true" elsewhere): a click on it is a no-op by design.
    alreadyCurrent: Boolean(target?.getAttribute('aria-current') && target.getAttribute('aria-current') !== 'false'),
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

// Every click starts from the same mock engine and storage. Without this, a config.patch or a stored pref from one
// control leaks into the next click's result. Module-level app singletons survive a remount, so the crawl also
// reloads the page once per screen (crawl.mjs).
function resetMockEngine() {
  config = freshConfig();
  prefs = freshPrefs();
  approvals = freshApprovals();
  voice = freshVoice();
  browserRunning = false;
  calls.length = 0;
  historyMoves = 0;
  popups = 0;
  downloads = 0;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage blocked: the defaults below still apply */ }
}

function mount(route: Route, level: LevelWord = 'technical') {
  resetMockEngine();
  localStorage.setItem('branch.route', JSON.stringify(route));
  localStorage.setItem('branch.level', level);
  localStorage.setItem('branch.theme', 'light');
  for (const toast of getToasts()) dismiss(toast.id);
  cachedEngine = null;
  marked = null;
  markedEl = null;
  if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`);
  const key = route.kind === 'chat' && route.key ? route.key : SESSIONS[0].key;
  snap = snapshot(key);
  nonce += 1;
  const host = document.getElementById('root');
  if (!host) return;
  root ??= createRoot(host);
  root.render(WINDOW_KIND === 'r1' ? <R1Root key={nonce} /> : <WindowShell key={nonce} session={fixture as never} url="ws://127.0.0.1:9" />);
}

// R1 has no connection marker of its own; the crawl waits for data-connection="ready" before it clicks, so the harness
// adds one here once the mock engine has answered. Classic's WindowShell sets its own marker.
function R1Root() {
  return <div data-connection="ready" style={{ height: '100vh' }}><R1Window session={fixture as never} /></div>;
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
// The crawl has no microphone or camera. Each capture request resolves to a silent stream of the kind it asked for, so
// a voice note really starts recording and the crawl observes that state. The audio context is built here, at load.
const capture = createCrawlCapture(() => new AudioContext());
if (typeof AudioContext === 'function') capture.prewarm();
if (navigator.mediaDevices) {
  navigator.mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) =>
    trackPermissionRequest(() => capture.capture(constraints));
}
if (typeof Notification !== 'undefined') {
  const nativeRequestPermission = Notification.requestPermission.bind(Notification);
  Notification.requestPermission = (...args: Parameters<typeof Notification.requestPermission>) =>
    trackPermissionRequest(() => nativeRequestPermission(...args));
}

// Headless Chromium leaves a clipboard write pending, so a Copy button never shows its result. The crawl's write
// succeeds at once, and the Copied line is the visible result.
if (navigator.clipboard) navigator.clipboard.writeText = () => Promise.resolve();

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
      window: WINDOW_KIND,
      sessions: [...SESSIONS.map((session) => ({ key: session.key, title: session.label })), ...(WINDOW_KIND === 'r1' ? [{ key: GRAFTED_KEY, title: 'Studio computer' }] : [])],
      places: PLACES.map((place) => place.id),
      settings: WINDOW_KIND === 'r1' ? r1SettingsScreens() : classicSettingsScreens(),
    };
  },
  collect, mark, clickTarget, surface, rowActions, listLabels, openKind,
  pendingPermissionRequests: () => pendingPermissionRequests,
};

mount({ kind: 'chat', key: SESSIONS[0].key });
