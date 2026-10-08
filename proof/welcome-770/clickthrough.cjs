const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('C:/Users/bishi/Code/dogfood-birch-770/window/node_modules/playwright');
const out = process.env.SELFTEST_OUT;
const token = fs.readFileSync(process.env.SELFTEST_TOKEN_FILE, 'utf8').trim();
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  console.log('Chrome PID:', browser._browserProcess?.process?.pid ?? 'managed by Playwright');
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', recordVideo: { dir: out, size: { width: 1440, height: 900 } } });
    const page = await context.newPage();
    // Fresh pre-connect Welcome: supply the scratch address, but let Where ask for its key.
    await page.addInitScript(() => { window.branchDesktop = { gatewayUrl: 'ws://127.0.0.1:19641' }; });
    await page.goto('http://127.0.0.1:5641/');
    const promise = page.getByTestId('setup-promise');
    const start = page.getByTestId('setup-next');
    await promise.waitFor({ timeout: 60000 });
    await page.getByTestId('setup-welcome-mark').locator('image').evaluate(async img => {
      const pic = new Image(); pic.src = img.getAttribute('href'); await pic.decode();
    });
    assert.equal(await promise.isChecked(), false);
    assert.equal(await start.isDisabled(), true);
    const safety = await page.locator('.may6 li').allTextContents();
    assert.deepEqual(safety, ['It asks before it sends, deletes, spends or installs anything.', 'Your conversations and keys stay on your computers.', 'You can take over, stop it, or roll back any change.']);
    assert.deepEqual(await page.locator('.ob-rail li').allTextContents(), ['1Welcome','2Where Branch runs','3Models','4Make it yours','5Your first Trunks','6Reach it anywhere','7Tools','8Keep it running','9People','10Two more things','11Health check']);
    assert.equal(await page.locator('.ob-rail li.done').count(), 0);
    assert.equal(await page.locator('.ob-rail li button:disabled').count(), 10);
    const mark = await page.getByTestId('setup-welcome-mark').evaluate(el => ({ color: getComputedStyle(el).color, ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), background: getComputedStyle(el).backgroundColor, fill: el.querySelector('rect').getAttribute('fill') }));
    assert.equal(mark.background, 'rgba(0, 0, 0, 0)');
    assert.equal(mark.fill, 'currentColor');
    await page.screenshot({ path: path.join(out, '01-load-start-off.png') });
    await page.waitForTimeout(1500);
    await promise.check();
    assert.equal(await start.isDisabled(), false);
    await page.screenshot({ path: path.join(out, '02-promise-start-on.png') });
    await page.waitForTimeout(1500);
    await start.click();
    await page.getByRole('heading', { name: 'Where should Branch run?' }).waitFor();
    assert.equal(await page.locator('.ob-rail li.done').count(), 1);
    assert.equal((await page.locator('.ob-rail li.done').innerText()).trim(), 'Welcome');
    await page.getByTestId('setup-pick-this').click();
    assert.equal(await page.getByTestId('setup-pick-this').getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: path.join(out, '03-where.png') });
    await page.waitForTimeout(2000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByRole('button', { name: 'Welcome', exact: false }).first().click();
    await page.getByTestId('setup-welcome-mark').waitFor();
    await page.screenshot({ path: path.join(out, '04-welcome-dark.png') });
    const video = page.video();
    await context.close(); context = undefined;
    fs.renameSync(await video.path(), path.join(out, 'welcome-clickthrough.webm'));
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ safety, mark, clickthrough: 'load -> tick -> Start -> Where (This computer); dark Welcome', assertions: 'passed' }, null, 2));
    console.log('Welcome click-through assertions passed; screenshots and recording saved.');
  } finally {
    if (context) await context.close();
    await browser.close();
    console.log('Chrome closed by Playwright.');
  }
})().catch(err => { console.error(String(err).replaceAll(token, '[redacted]')); process.exitCode = 1; });
