// Detail kept beside a console-error tag. The gate used to store only the tag, so a
// failure could not be traced. Each message is capped, and secrets, emails, machine
// names, and absolute paths are stripped before anything is written.

export const MAX_CONSOLE_CHARS = 2000;
export const MAX_CONSOLE_PER_KEY = 5;

const REPO_MARKERS = ['window', 'engine', 'scripts', 'desktop', 'assets', 'docs'];
const HTTP_URL = /https?:\/\/[^\s)'"]+/gi;
// Only a path that starts a token. A relative frame such as window/src/a.tsx must stay as written;
// matching the slash inside it would turn the rest into a stripped absolute path.
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g;
const MACHINE = /\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{4,}\b/g;
const MDNS = /\b([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)\.local\b/gi;
const SECRETS = [
  /bearer\s+[A-Za-z0-9._~+/-]{8,}/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization)\b\s*[=:]\s*['"]?[^\s'"]+/gi,
  /\bsk-[A-Za-z0-9]{8,}\b/g,
  /\bghp_[A-Za-z0-9]{8,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/g,
];

function clip(text) {
  const value = String(text ?? '');
  if (value.length <= MAX_CONSOLE_CHARS) return value;
  return `${value.slice(0, MAX_CONSOLE_CHARS - 1)}…`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRoot(root) {
  const value = String(root ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
  return value;
}

function splitSuffix(token) {
  const match = /:(\d+):(\d+)$/.exec(token) || /:(\d+)$/.exec(token);
  if (!match) return { body: token, suffix: '' };
  return { body: token.slice(0, match.index), suffix: match[0] };
}

function toRepoRelative(path, root) {
  const normal = String(path || '').replaceAll('\\', '/');
  if (root && (normal === root || normal.startsWith(`${root}/`))) {
    return normal.slice(root.length).replace(/^\/+/, '') || '.';
  }
  for (const marker of REPO_MARKERS) {
    const at = normal.indexOf(`/${marker}/`);
    if (at !== -1) return normal.slice(at + 1);
  }
  return '';
}

function rewritePathToken(token, root) {
  const { body, suffix } = splitSuffix(token);
  let path = body;
  if (/^file:/i.test(path)) {
    try {
      path = decodeURIComponent(path.replace(/^file:\/\/\/?/i, '/'));
    } catch {
      path = path.replace(/^file:\/\/\/?/i, '/');
    }
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  }
  const relativePath = toRepoRelative(path, normalizeRoot(root));
  if (relativePath) return `${relativePath}${suffix}`;
  const base = path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'path';
  return `<path>/${base}${suffix}`;
}

function stripRoot(text, root) {
  const normal = normalizeRoot(root);
  if (!normal) return text;
  return text.replace(new RegExp(escapeRegExp(normal) + '(?=/|$)', 'g'), '');
}

function rewriteHttpUrl(url, root) {
  let next = url;
  try { next = decodeURIComponent(url); } catch { /* keep the raw url */ }
  next = stripRoot(next, root);
  next = next.replace(/@fs\/(?:[A-Za-z]:\/|\/)?(?:[^/\s]+\/)*?(?=(?:window|engine|scripts|desktop|assets|docs)\/)/g, '');
  next = next.replace(/\/(?:Users|home)\/[^/\s]+/g, '/~');
  next = next.replace(/@fs\/[^\s)'"]+/g, (abs) => rewritePathToken(abs.slice('@fs/'.length), root));
  return next;
}

/** Remove secrets, emails, machine names, and absolute paths. Repo files stay repo-relative. */
export function sanitizeConsoleText(text, root = '') {
  let value = String(text ?? '');
  for (const pattern of SECRETS) value = value.replace(pattern, '[redacted]');
  value = value.replace(EMAIL, '[redacted]');
  const urls = [];
  value = value.replace(HTTP_URL, (url) => {
    urls.push(rewriteHttpUrl(url, root));
    return `\u0000${urls.length - 1}\u0000`;
  });
  value = value.replace(/(^|[\s('"=`])((?:file:\/\/\/?|[A-Za-z]:[\\/]|\/)[^\s)'"]+)/gi, (full, lead, token) => (
    `${lead}${rewritePathToken(token, root)}`
  ));
  value = value.replace(/\u0000(\d+)\u0000/g, (_, index) => urls[Number(index)]);
  value = value.replace(MACHINE, '[host]');
  value = value.replace(MDNS, (host, label) => (String(label).includes('-') ? '[host]' : host));
  return value;
}

export function sanitizeScreenshot(screenshot, root = '') {
  const raw = String(screenshot ?? '').trim();
  if (!raw) return '';
  const cleaned = sanitizeConsoleText(raw, root).replace(/^[/\\]+/, '');
  if (!cleaned || cleaned.includes('..')) return '';
  if (cleaned.includes('[redacted]') || cleaned.includes('<path>') || cleaned.includes('[host]') || cleaned.startsWith('~')) return '';
  if (/^[a-z][a-z0-9.+-]*:/i.test(cleaned)) return '';
  return cleaned;
}

function asMessage(record) {
  if (typeof record === 'string') return { text: record, stack: '' };
  return { text: record?.text ?? '', stack: record?.stack ?? '' };
}

/**
 * Keep at most MAX_CONSOLE_PER_KEY messages for one gated key.
 * A later call fills any room left; it does not drop messages already kept.
 */
export function addConsoleEvidence(store, key, records, options = {}) {
  const root = options.root || '';
  const incoming = [];
  for (const record of records || []) {
    const message = asMessage(record);
    const text = clip(sanitizeConsoleText(message.text, root));
    const stack = clip(sanitizeConsoleText(message.stack, root));
    if (!text && !stack) continue;
    incoming.push({ text, stack });
  }
  const shot = sanitizeScreenshot(options.screenshot || '', root);
  const previous = store[key];
  const kept = [...(previous?.messages || [])];
  for (const message of incoming) {
    if (kept.length >= MAX_CONSOLE_PER_KEY) break;
    kept.push(message);
  }
  const screenshot = previous?.screenshot || shot;
  if (!kept.length && !screenshot) return store;
  store[key] = screenshot ? { messages: kept, screenshot } : { messages: kept };
  return store;
}

function labeledLines(label, text) {
  const parts = String(text).split(/\r?\n/);
  return parts.map((part, index) => (index === 0 ? `  ${label}: ${part}` : `  ${part}`));
}

/** Lines printed under a console-error gate row. Empty when nothing was kept. */
export function consoleEvidenceGateLines(entry) {
  if (!entry) return [];
  const lines = [];
  for (const message of entry.messages || []) {
    if (message.text) lines.push(...labeledLines('text', message.text));
    if (message.stack && message.stack !== message.text) lines.push(...labeledLines('stack', message.stack));
  }
  if (entry.screenshot) lines.push(`  screenshot: ${entry.screenshot}`);
  return lines;
}

export function consoleEvidenceBody(evidence) {
  const keys = Object.keys(evidence || {}).sort((a, b) => a.localeCompare(b));
  if (!keys.length) return 'None.';
  const lines = [];
  for (const key of keys) {
    lines.push(`- ${key}`);
    const detail = consoleEvidenceGateLines(evidence[key]);
    lines.push(...(detail.length ? detail : ['  (no text kept)']));
  }
  return lines.join('\n');
}
