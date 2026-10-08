// node --test scripts/check-window-clean.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  IMPORT_ALLOWLIST,
  STALE_NAME_EXCEPTIONS,
  baselinePath,
  checkWindowClean,
  compareFindings,
  findingKey,
  fontShorthandFamily,
  isHardcodedFontFamily,
  isScannedPath,
  isStaleDeclarationName,
  parseBaseline,
  root,
  scanText,
  scanTree,
  toastOnlyHandlers,
} from './check-window-clean.mjs';

function keys(file, text) {
  return scanText(file, text).map(findingKey);
}

test('user-visible old product names fail and comments do not', () => {
  const hits = keys('window/src/Welcome.tsx', `
    export function Welcome() {
      // Copied from OpenClaw's sidebar.
      return <h1>Welcome to OpenClaw</h1>;
    }
  `);
  assert.equal(hits.filter((key) => key.startsWith('product-name')).length, 1);
  assert.match(hits[0], /Welcome to OpenClaw/);
});

test('aria labels, placeholders, and toasts are user-visible', () => {
  const hits = keys('window/src/Copy.tsx', `
    export function Copy() {
      toast("Crabbox is ready");
      return <input aria-label="crustacean" placeholder="claw" title="ClawHub" />;
    }
  `);
  const names = hits.filter((key) => key.startsWith('product-name'));
  assert.equal(names.length, 4);
  assert.match(names.join('\n'), /Crabbox is ready/);
  assert.match(names.join('\n'), /crustacean/);
  assert.match(names.join('\n'), /placeholder="claw"/);
  assert.match(names.join('\n'), /ClawHub/);
});

test('protocol ids and allowlisted import paths are not window copy', () => {
  const protocol = keys('window/src/Install.tsx', `
    const row = { id: "crabbox", source: "clawhub", label: "Cuttings" };
    import pkg from "@openclaw/crabline";
    const local = require("openclaw/legacy");
  `);
  assert.deepEqual(protocol.filter((key) => key.startsWith('product-name')), []);

  const prose = keys('window/src/Install.tsx', 'const note = "Install @openclaw/crabline from the catalog";');
  const shown = prose.filter((key) => key.startsWith('product-name'));
  assert.equal(shown.length, 2);
  assert.match(shown.join('\n'), /openclaw/);
  assert.match(shown.join('\n'), /crabline/);
});

test('import allowlist is small and each rule says why', () => {
  assert.ok(IMPORT_ALLOWLIST.length >= 1);
  assert.ok(IMPORT_ALLOWLIST.length <= 4);
  for (const rule of IMPORT_ALLOWLIST) {
    assert.equal(typeof rule.id, 'string');
    assert.match(rule.why, /import|package|module|npm/i);
    assert.equal(typeof rule.allows, 'function');
  }
});

test('raw colors and font stacks fail outside the token file', () => {
  const hits = keys('window/src/panel.css', `
    #root { color: #fff; background: rgb(1, 2, 3); }
    .ok { color: var(--ink); font-family: var(--sans); font-family: inherit; }
    .bad { font-family: Georgia, "Times New Roman", serif; border-color: hsl(10, 20%, 30%); }
    @font-face { font-family: "Geist"; }
    :root { --local: #abc; }
  `);
  const theme = hits.filter((key) => key.startsWith('theme'));
  assert.ok(theme.some((key) => key.includes('#fff')));
  assert.ok(theme.some((key) => key.includes('rgb(1, 2, 3)')));
  assert.ok(theme.some((key) => key.includes('Georgia')));
  assert.ok(theme.some((key) => key.includes('hsl(10, 20%, 30%)')));
  assert.equal(theme.some((key) => key.includes('#root') && !key.includes('#fff')), false);
  assert.equal(theme.some((key) => key.includes('var(--sans)')), false);
  assert.equal(theme.some((key) => key.includes('font-family: inherit')), false);
  assert.equal(theme.some((key) => /font-family: "Geist"/.test(key)), false);
  assert.equal(theme.some((key) => key.includes('#abc')), false);
});

test('token file colors are the allowed home', () => {
  const hits = keys('window/src/theme/tokens.css', ':root { --ink: #141d24; --sans: "Geist", sans-serif; }');
  assert.deepEqual(hits.filter((key) => key.startsWith('theme')), []);
});

test('style objects use the same color and font rules', () => {
  const hits = keys('window/src/Chip.tsx', `
    const ok = { fontFamily: "var(--sans)", color: "var(--ink)" };
    const bad = { fontFamily: "Georgia, serif", color: "#fff" };
  `);
  const theme = hits.filter((key) => key.startsWith('theme'));
  assert.equal(theme.length, 2);
  assert.ok(theme.some((key) => key.includes('Georgia')));
  assert.ok(theme.some((key) => key.includes('#fff')));
});

test('font shorthand keeps a token and flags a raw family', () => {
  assert.equal(fontShorthandFamily('14px/1.5 var(--sans)'), 'var(--sans)');
  assert.equal(isHardcodedFontFamily('var(--sans)'), false);
  assert.equal(isHardcodedFontFamily('inherit'), false);
  assert.equal(isHardcodedFontFamily('Georgia, serif'), true);
  const hits = keys('window/src/type.css', 'body { font: 14px/1.5 var(--sans); } h1 { font: 26px Georgia, serif; }');
  const theme = hits.filter((key) => key.startsWith('theme'));
  assert.equal(theme.length, 1);
  assert.match(theme[0], /Georgia/);
});

test('input placeholders and the fallback-model settings are not stubs', () => {
  const hits = keys('window/src/Search.tsx', `
    export function FallbackLists() { return <input placeholder="Search cards" />; }
    function FallbackList() { return null; }
    function TrunkFallbackNote() { return null; }
    function Fallbacks() { return null; }
  `);
  assert.deepEqual(hits.filter((key) => key.startsWith('stale')), []);
  for (const name of STALE_NAME_EXCEPTIONS) assert.equal(isStaleDeclarationName(name), false);
});

test('stale markers, legacy names, and toast-only clicks fail', () => {
  const source = `
    // Legacy prop for callers.
    function dueFallback() { return "soon"; }
    export function legacyOutsideId(id: string) { return id; }
    export const LEGACY_THEMES = [];
    const copy = "coming soon";
    const missing = "not implemented";
    const filler = "lorem ipsum";
    // TODO-fallback until the real call exists
    // return transparent placeholder sprites
    const mockData = [1];
    export function Row() {
      return <button onClick={() => toast("Saved for later")}>Later</button>;
    }
  `;
  const hits = keys('window/src/Old.tsx', source);
  const stale = hits.filter((key) => key.startsWith('stale'));
  assert.ok(stale.some((key) => key.includes('Legacy prop')));
  assert.ok(stale.some((key) => key.includes('dueFallback')));
  assert.ok(stale.some((key) => key.includes('legacyOutsideId')));
  assert.ok(stale.some((key) => key.includes('LEGACY_THEMES')));
  assert.ok(stale.some((key) => key.includes('coming soon')));
  assert.ok(stale.some((key) => key.includes('not implemented')));
  assert.ok(stale.some((key) => key.includes('lorem ipsum')));
  assert.ok(stale.some((key) => key.includes('TODO-fallback')));
  assert.ok(stale.some((key) => key.includes('placeholder sprites')));
  assert.ok(stale.some((key) => key.includes('mockData')));
  assert.ok(stale.some((key) => key.includes('toast("Saved for later")')));
});

test('legacy comments stay visible after a template string', () => {
  const source = 'const id = `${row}`;\n// Not a legacy type — keep as-is\n';
  const hits = keys('window/src/Old.tsx', source);
  assert.ok(hits.some((key) => key.includes('legacy type')));
});

test('a click that toasts and also does the work is not toast-only', () => {
  const source = 'export function Row() { return <button onClick={() => { copyText(text, toast); }}>Copy</button>; }';
  assert.equal(toastOnlyHandlers(source).length, 0);
  assert.deepEqual(keys('window/src/Copy.tsx', source).filter((key) => key.startsWith('stale')), []);
});

test('tests and generated bundles are not the screen', () => {
  assert.equal(isScannedPath('window/src/shell/Sidebar.tsx'), true);
  assert.equal(isScannedPath('window/index.html'), true);
  assert.equal(isScannedPath('window/src/shell/Sidebar.test.tsx'), false);
  assert.equal(isScannedPath('window/src/places/office/pixel/webview-ui/src/branch/generated/assets.gen.ts'), false);
  assert.equal(isScannedPath('engine/src/wizard/setup.ts'), false);
});

test('a new violation fails and names the fix', () => {
  const findings = scanText('window/src/New.tsx', 'export const title = "Welcome to OpenClaw";');
  const result = checkWindowClean(findings, '# empty\n');
  assert.equal(result.ok, false);
  assert.equal(result.fresh.length, 1);
  assert.match(result.text, /New window cleanliness violation/);
  assert.match(result.text, /product-name/);
  assert.match(result.text, /Replace the old product name/);
  assert.match(result.text, /Welcome to OpenClaw/);
});

test('a baselined violation passes, and a fixed one asks to delete the baseline line', () => {
  const file = 'window/src/Old.tsx';
  const text = 'export const title = "Welcome to Crabbox";';
  const findings = scanText(file, text);
  const baseline = findings.map(findingKey).join('\n') + '\n';
  const kept = checkWindowClean(findings, baseline);
  assert.equal(kept.ok, true);
  assert.equal(kept.fresh.length, 0);
  assert.equal(kept.stale.length, 0);
  assert.match(kept.text, /Baselined product-name: 1 \(pass\)/);

  const gone = checkWindowClean([], baseline);
  assert.equal(gone.ok, false);
  assert.match(gone.text, /stale baseline entry, delete it/);
  assert.match(gone.text, /Crabbox/);
});

test('duplicate snippets shrink one at a time', () => {
  const finding = { category: 'theme', file: 'window/src/a.css', snippet: 'color: #fff' };
  const result = compareFindings([finding], [findingKey(finding), findingKey(finding)]);
  assert.equal(result.fresh.length, 0);
  assert.equal(result.stale.length, 1);
  assert.equal(result.kept.length, 1);
});

test('the repo baseline matches the window that is on disk', () => {
  const baseline = parseBaseline(readFileSync(new URL(`../${baselinePath}`, import.meta.url), 'utf8'));
  const result = checkWindowClean(scanTree(root), baseline.join('\n'));
  assert.deepEqual(result.fresh, []);
  assert.deepEqual(result.stale, []);
  assert.equal(result.ok, true);
});
