#!/usr/bin/env node
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readScreens } from './visual-tour/manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../engine/package.json', import.meta.url));

function checkNodeVersion() {
  const current = process.versions.node;
  const required = '24.19.0';
  const [reqMajor, reqMinor, reqPatch] = required.split('.').map(Number);
  const [curMajor, curMinor, curPatch] = current.split('.').map(Number);
  
  if (curMajor < reqMajor || (curMajor === reqMajor && curMinor < reqMinor)) {
    console.error(`\nNode version mismatch:`);
    console.error(`  Current:  v${current}`);
    console.error(`  Required: v${required} or higher`);
    console.error(`\nThis script requires Node.js 24.19.0 or higher to match CI.`);
    console.error(`Install the correct version with:`);
    console.error(`  nvm install ${required}`);
    console.error(`  nvm use ${required}`);
    console.error(`Or with other Node version managers:`);
    console.error(`  n ${required}`);
    console.error(`  fnm install ${required} && fnm use ${required}`);
    process.exit(1);
  }
  
  if (curMajor > reqMajor || (curMajor === reqMajor && curMinor > reqMinor) || 
      (curMajor === reqMajor && curMinor === reqMinor && curPatch > reqPatch + 10)) {
    console.warn(`\nWarning: Using Node v${current}, which is newer than CI (v${required}).`);
    console.warn(`Screenshots may differ slightly from CI. Consider using the exact CI version.\n`);
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  let screens = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--screens' && i + 1 < args.length) {
      screens = args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      break;
    }
  }
  return { screens };
}

async function findFreePorts(base, count, avoid) {
  const net = await import('node:net');
  const ports = [];
  for (let port = base; ports.length < count && port < base + 1000; port++) {
    if (avoid.includes(port)) continue;
    try {
      await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.once('listening', () => {
          server.close();
          resolve();
        });
        server.listen(port, '127.0.0.1');
      });
      ports.push(port);
    } catch {}
  }
  if (ports.length < count) throw new Error(`Could not find ${count} free ports starting from ${base}`);
  return ports;
}

function run(cmd, args, opts = {}) {
  const env = { ...process.env, ...opts.env };
  const nodeBin = require('path').dirname(process.execPath);
  env.PATH = `${nodeBin}${require('path').delimiter}${env.PATH}`;
  
  const result = spawnSync(cmd, args, { 
    cwd: opts.cwd || root, 
    encoding: 'utf8', 
    env,
    windowsHide: true,
    stdio: opts.stdio || 'pipe',
    timeout: opts.timeout || 120000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${result.status}\n${result.stderr}`);
  }
  return result;
}

async function main() {
  checkNodeVersion();
  
  const { screens: screenFilter } = parseArgs();
  const screens = await readScreens(new URL('./visual-tour/screens.json', import.meta.url));
  const selectedScreens = screenFilter.length 
    ? screens.filter((s) => screenFilter.includes(s.id))
    : screens;
  
  if (selectedScreens.length === 0) {
    console.error('No screens matched the filter. Available screens:');
    console.error(screens.map((s) => `  - ${s.id}`).join('\n'));
    process.exit(1);
  }
  
  console.log(`Running proof for ${selectedScreens.length} screen(s): ${selectedScreens.map((s) => s.id).join(', ')}`);
  
  const startTime = Date.now();
  const stateDir = mkdtempSync(resolve(tmpdir(), 'branch-proof-'));
  const outputDir = resolve(root, 'artifacts/proof');
  mkdirSync(outputDir, { recursive: true });
  
  const avoidPorts = [19031, 19032, 19651, 5651];
  const [gatewayPort, windowPort] = await findFreePorts(20000, 2, avoidPorts);
  
  const gatewayToken = require('node:crypto').randomBytes(32).toString('hex');
  const tokenFile = resolve(stateDir, 'token');
  writeFileSync(tokenFile, gatewayToken, { mode: 0o600 });
  
  const env = {
    ...process.env,
    BRANCH_HOME: stateDir,
    BRANCH_SKIP_CHANNELS: '1',
    BRANCH_GATEWAY_TOKEN: gatewayToken,
    VISUAL_GATEWAY_PORT: String(gatewayPort),
    VISUAL_WINDOW_PORT: String(windowPort),
    VISUAL_OUT: outputDir,
    VISUAL_TOKEN_FILE: tokenFile,
  };
  
  console.log('Building engine (ciBuildSeed)...');
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: resolve(root, 'engine') });
  run(process.execPath, ['--import', './scripts/tsx.mjs', 'scripts/build-all.mts', 'ciBuildSeed'], { 
    cwd: resolve(root, 'engine'),
    timeout: 300000
  });
  
  console.log('Building window...');
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: resolve(root, 'window') });
  run('pnpm', ['build'], { cwd: resolve(root, 'window') });
  
  console.log('Installing Playwright...');
  run('pnpm', ['-C', 'engine', 'exec', 'playwright', 'install', 'chromium']);
  
  console.log(`Starting gateway on port ${gatewayPort}...`);
  const gateway = spawn(
    process.execPath,
    ['branch.mjs', 'gateway', '--dev', '--port', String(gatewayPort)],
    { cwd: resolve(root, 'engine'), env, windowsHide: true, stdio: 'pipe' }
  );
  
  console.log(`Starting window preview on port ${windowPort}...`);
  const window = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(windowPort), '--strictPort'],
    { cwd: resolve(root, 'window'), env, windowsHide: true, stdio: 'pipe' }
  );
  
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    console.log('Cleaning up processes...');
    try { gateway.kill(); } catch {}
    try { window.kill(); } catch {}
  };
  
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
  
  console.log('Waiting for services to be ready...');
  const http = await import('node:http');
  for (let attempt = 0; attempt < 90; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    try {
      const gatewayReady = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${gatewayPort}/readyz`, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      });
      const windowReady = await new Promise((resolve) => {
        const req = http.get(`http://127.0.0.1:${windowPort}/`, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => { req.destroy(); resolve(false); });
      });
      if (gatewayReady && windowReady) {
        console.log('Services ready!');
        break;
      }
    } catch {}
    if (attempt === 89) {
      cleanup();
      throw new Error('Services did not become ready in time');
    }
  }
  
  console.log('Seeding data...');
  run(process.execPath, ['scripts/visual-tour/seed.mjs'], { cwd: root, env });
  
  console.log('Capturing screenshots...');
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ headless: true });
  const fixture = JSON.parse(readFileSync(resolve(outputDir, 'fixture.json'), 'utf8'));
  const token = readFileSync(tokenFile, 'utf8').trim();
  const gateway_ws = `ws://127.0.0.1:${gatewayPort}`;
  const windowUrl = `http://127.0.0.1:${windowPort}`;
  
  function locate(page, by, target) {
    if (by === 'testid') return page.getByTestId(target);
    if (by === 'text') return page.getByText(target, { exact: true });
    if (by === 'role') return page.getByRole(target);
    return page.locator(target);
  }
  
  const { checkedStep } = await import('./visual-tour/dead-click.mjs');
  const failures = [];
  const shotPaths = [];
  
  try {
    for (const theme of ['light', 'dark']) {
      for (const width of [1280, 700]) {
        const context = await browser.newContext({ 
          viewport: { width, height: 860 }, 
          colorScheme: theme 
        });
        const page = await context.newPage();
        await page.addInitScript(([url, key, look]) => {
          window.branchDesktop = { gatewayUrl: url, gatewayToken: key };
          localStorage.setItem('branch.theme', look);
        }, [gateway_ws, token, theme]);
        
        for (const screen of selectedScreens) {
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
            
            if (width === 700 && ['main-chat', 'new-menu', 'settings-general', 'settings-accounts', 'add-claude-account', 'settings-updates', 'group-chat', 'topics'].includes(screen.id)) {
              const list = page.getByTestId('list-toggle');
              if (!(await page.locator('.frame').evaluate((node) => node.classList.contains('slide-open')))) {
                await list.click();
              }
            }
            
            for (const step of screen.steps) {
              await checkedStep(page, step, locate);
            }
            
            const shotPath = resolve(outputDir, `${stem}.png`);
            await page.screenshot({ path: shotPath });
            shotPaths.push(`${stem}.png`);
            console.log(`  ✓ ${stem}`);
          } catch (error) {
            failures.push(`${stem}: ${error.message}`);
            console.log(`  ✗ ${stem}: ${error.message}`);
            const failPath = resolve(outputDir, `${stem}-failed.png`);
            await page.screenshot({ path: failPath }).catch(() => {});
          }
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    cleanup();
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nProof complete in ${elapsed}s`);
  console.log(`Captured ${shotPaths.length}/${selectedScreens.length * 4} screenshots`);
  console.log(`Output: ${outputDir}`);
  
  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`);
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Proof failed:', err.message);
  process.exit(1);
});
