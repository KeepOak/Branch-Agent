import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { drivePreview, previewDriveFailure, previewScreenPatch, previewState } from './preview.mjs';

test('preview driver names the step when the hook is missing', async () => {
  const missing = { evaluate: async () => { throw new Error('preview hook is missing'); } };
  await assert.rejects(
    () => drivePreview(missing, 'settings-general'),
    /Cannot drive preview for settings-general: preview hook is missing/,
  );
  const leaked = { evaluate: async () => { throw new ReferenceError('S is not defined'); } };
  await assert.rejects(
    () => drivePreview(leaked, 'pixel-office'),
    /Cannot drive preview for pixel-office: S is not defined/,
  );
  assert.match(previewDriveFailure('inbox', new Error('page.evaluate: ReferenceError: S is not defined')), /Cannot drive preview for inbox: S is not defined/);
  assert.deepEqual(previewScreenPatch(previewState('settings-general')), { view: 'settings', setPage: 'general' });
  assert.deepEqual(previewScreenPatch(previewState('pixel-office')), { view: 'groveT5' });
});

test('preview driver captures at least two spec-v23 screens headlessly', async () => {
  const require = createRequire(new URL('../../engine/package.json', import.meta.url));
  const { chromium } = require('playwright-core');
  const previewHtml = fileURLToPath(new URL('../../design/spec-v23/index.html', import.meta.url));
  const out = mkdtempSync(join(tmpdir(), 'branch-preview-drive-'));
  const browser = await chromium.launch({ headless: true });
  const captured = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(pathToFileURL(previewHtml).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__preview?.setScreen), { timeout: 30000 });
    for (const id of ['main-chat', 'settings-general']) {
      await drivePreview(page, id);
      const path = join(out, `${id}-preview.png`);
      await page.screenshot({ path });
      assert.ok(statSync(path).size > 1000, `${id} screenshot was empty`);
      captured.push(path);
    }
    assert.equal(await page.evaluate(() => window.__preview.state.view), 'settings');
    assert.equal(await page.evaluate(() => window.__preview.state.setPage), 'general');
    await page.locator('h1').filter({ hasText: 'General' }).first().waitFor({ timeout: 5000 });
    const blank = await browser.newPage();
    await blank.goto('about:blank');
    await assert.rejects(
      () => drivePreview(blank, 'inbox'),
      /Cannot drive preview for inbox: preview hook is missing/,
    );
    assert.equal(captured.length, 2);
    assert.ok(statSync(captured[0]).size > 1000);
    assert.ok(statSync(captured[1]).size > 1000);
    await blank.close();
    await page.close();
  } finally {
    await browser.close();
    rmSync(out, { recursive: true, force: true });
  }
});
