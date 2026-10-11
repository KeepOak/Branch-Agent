import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readScreens } from './manifest.mjs';
import { checkedStep } from './dead-click.mjs';
import { gatewayPort } from './gateway-port.mjs';
import { drivePreview } from './preview.mjs';

const require = createRequire(new URL('../../engine/package.json', import.meta.url));
const { chromium } = require('playwright-core');
const screens = await readScreens(new URL('./screens.json', import.meta.url));
const out = resolve(process.env.VISUAL_OUT ?? 'visual-tour-output');
const fixture = JSON.parse(await readFile(resolve(out, 'fixture.json'), 'utf8'));
const token = (await readFile(process.env.VISUAL_TOKEN_FILE, 'utf8')).trim();
const gateway = `ws://127.0.0.1:${gatewayPort()}`;
const windowUrl = `http://127.0.0.1:${process.env.VISUAL_WINDOW_PORT}`;
const previewUrl = process.env.VISUAL_PREVIEW_PORT ? `http://127.0.0.1:${process.env.VISUAL_PREVIEW_PORT}` : null;
const failures = [], consoleErrors = [], shots = [];
const pairs = [];
await mkdir(out, { recursive: true });

function locate(page, by, target) {
  if (by === 'testid') return page.getByTestId(target);
  if (by === 'text') return page.getByText(target, { exact: true });
  if (by === 'role') return page.getByRole(target);
  return page.locator(target);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ['light', 'dark']) for (const width of [1280, 700]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: theme });
    const page = await context.newPage();
    page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(`${theme}/${width}: ${entry.text()}`); });
    page.on('pageerror', (error) => consoleErrors.push(`${theme}/${width}: ${error.message}`));
    await page.addInitScript(([url, key, look]) => {
      window.branchDesktop = { gatewayUrl: url, gatewayToken: key };
      localStorage.setItem('branch.theme', look);
      localStorage.setItem('branch-proto-welcomed', '1');
      localStorage.setItem('branch-proto-seen13', '1');
    }, [gateway, token, theme]);
    for (const screen of screens) {
      const stem = `${theme}-${width}-${screen.id}`;
      try {
        await page.goto(windowUrl, { waitUntil: 'domcontentloaded' });
        await page.locator('[data-connection=ready]').waitFor({ timeout: 60000 });
        const route = screen.route?.key === '$research'
          ? { ...screen.route, key: fixture.researchKey }
          : screen.route ?? { kind: 'chat', key: null };
        await page.evaluate((value) => localStorage.setItem('branch.route', JSON.stringify(value)), route);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('[data-connection=ready]').waitFor({ timeout: 60000 });
        await page.getByText('Researcher', { exact: true }).first().waitFor({ state: 'attached', timeout: 30000 });
        if (width === 700 && ['main-chat', 'new-menu', 'settings-general', 'settings-accounts', 'add-claude-account', 'settings-updates', 'group-chat', 'topics', 'row-menu'].includes(screen.id)) {
          const list = page.getByTestId('list-toggle');
          // At narrow widths the button opens a slide-out drawer. aria-pressed
          // describes the desktop rail, not the drawer's open state.
          if (!(await page.locator('.frame').evaluate((node) => node.classList.contains('slide-open')))) await list.click();
        }
        for (const step of screen.steps) await checkedStep(page, step, locate);
        await page.screenshot({ path: resolve(out, `${stem}.png`) });
        shots.push(`${stem}.png`);
      } catch (error) {
        failures.push(`${stem}: ${error.message}`);
        await page.screenshot({ path: resolve(out, `${stem}-failed.png`) }).catch(() => {});
      }
    }
    if (previewUrl) {
      const preview = await context.newPage();
      await preview.goto(previewUrl, { waitUntil: 'domcontentloaded' });
      await preview.locator('#app').waitFor();
      for (const screen of screens) {
        const stem = `${theme}-${width}-${screen.id}`;
        try {
          await drivePreview(preview, screen.id);
          if (screen.id === 'add-claude-account') await preview.getByText('Add a Claude account', { exact: true }).first().click().catch(() => {});
          if (screen.id === 'row-menu') await preview.locator('.row[data-id]').first().click({ button: 'right' }).catch(() => {});
          await preview.screenshot({ path: resolve(out, `${stem}-preview.png`) });
          pairs.push({ app: `${stem}.png`, preview: `${stem}-preview.png` });
        } catch (error) {
          const message = error.message.includes(`preview for ${screen.id}`)
            ? error.message
            : `Cannot drive preview for ${screen.id}: ${error.message}`;
          failures.push(`${stem} preview: ${message}`);
        }
      }
      await preview.close();
    }
    await context.close();
  }
} finally { await browser.close(); }
const report = { shots, pairs, deadControls: failures, consoleErrors };
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
if (pairs.length) {
  const cells = pairs.map(({ app, preview }) => `<figure><img src="${app}"><img src="${preview}"><figcaption>${app.replace('.png', '')}</figcaption></figure>`).join('\n');
  await writeFile(resolve(out, 'pairs.html'), `<!doctype html><meta charset="utf-8"><title>Visual tour parity</title><style>body{font:14px system-ui;background:#111;color:white}figure{margin:28px 0;display:grid;grid-template-columns:1fr 1fr;gap:12px}img{width:100%}figcaption{grid-column:1/-1}</style><h1>App / v23 preview</h1>${cells}`);
}
await writeFile(resolve(out, 'report.md'), `# Visual tour\n\n${shots.length}/${screens.length * 4} captures.\n\n## Dead controls\n${failures.map((x) => `- ${x}`).join('\n') || 'None'}\n\n## Console errors\n${consoleErrors.map((x) => `- ${x}`).join('\n') || 'None'}\n`);
console.log(`${shots.length}/${screens.length * 4} captures; ${failures.length} dead controls; ${consoleErrors.length} console errors`);
if (failures.length || consoleErrors.length) process.exitCode = 1;
