import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const engine = path.join(root, 'engine');
const requireEngine = createRequire(path.join(engine, 'package.json'));
const MB = 1_000_000;

export function parseMemorySample(value) {
  if (value?.type !== 'worker-memory' ||
      !Number.isSafeInteger(value.rssBytes) || value.rssBytes <= 0 ||
      !Number.isSafeInteger(value.peakBytes) || value.peakBytes < value.rssBytes) {
    throw new Error('Invalid worker memory sample');
  }
  return { rssBytes: value.rssBytes, peakBytes: value.peakBytes };
}

export function reportMeasurement({ platform, arch, startupMs, idleSamples, samples, proof }) {
  assert(['win32', 'darwin', 'linux'].includes(platform), 'Unsupported measurement OS');
  assert(Number.isFinite(startupMs) && startupMs > 0, 'Missing worker start time');
  assert(idleSamples.length > 0 && samples.length > 0, 'Missing worker memory samples');
  assert.equal(proof.providerCalls, 1, 'Expected one fake inference turn');
  assert(proof.transcriptCommits > 0, 'Missing transcript commit');
  const idle = idleSamples.map(parseMemorySample).map(s => s.rssBytes).sort((a, b) => a - b);
  const idleRssBytes = idle[Math.floor(idle.length / 2)];
  const peakRssBytes = Math.max(...samples.map(parseMemorySample).map(s => s.peakBytes));
  assert(peakRssBytes >= idleRssBytes, 'Peak RSS is below idle RSS');
  return { schema: 1, platform, arch, node: process.version,
    idleRssBytes, peakRssBytes, startupMs: Math.round(startupMs),
    idleRssMB: +(idleRssBytes / MB).toFixed(2), peakRssMB: +(peakRssBytes / MB).toFixed(2),
    idleSampleCount: idle.length, sampleCount: samples.length, ...proof,
    recommendation: idleRssBytes < 400 * MB ? 'per-turn child' : 'pooled worker' };
}

export function formatMeasurement(result) {
  return '| OS | Architecture | Idle RSS (MB) | Peak RSS (MB) | Start (ms) | Recommendation |\n' +
    '| --- | --- | ---: | ---: | ---: | --- |\n' +
    `| ${result.platform} | ${result.arch} | ${result.idleRssMB} | ${result.peakRssMB} | ${result.startupMs} | ${result.recommendation} |\n`;
}

async function buildWorker() {
  // Use exactly the release worker configurations, including sealed storage
  // children and Browser composition. No test substitute enters the worker.
  process.chdir(engine);
  process.env.BRANCH_RUN_NODE_SKIP_DTS_BUILD = '1';
  const { default: configs } = await import(pathToFileURL(path.join(engine, 'tsdown.config.ts')));
  const { build } = await import(pathToFileURL(requireEngine.resolve('tsdown')));
  for (const config of configs.filter(c => {
    const entries = Object.keys(c.entry ?? {});
    return entries.length > 0 && entries.every(k => k.startsWith('worker/'));
  })) {
    await build({ ...config, config: false, clean: false });
  }
}

function child(entry, args, env, execArgv) {
  const processChild = fork(entry, args, { cwd: engine, env, execArgv,
    windowsHide: true, detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  // Never print launch envelopes, scratch paths or diagnostics containing them.
  let diagnostics = '';
  processChild.stdout.on('data', () => {});
  processChild.stderr.on('data', chunk => { diagnostics += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        const stage = [...diagnostics.matchAll(/Scratch gateway: ([a-z ]+)/g)].at(-1)?.[1];
        reject(new Error(`Measurement child failed (${code ?? signal})${stage ? ` during ${stage}` : ''}`));
      }
    });
  });
  void exited.catch(() => {});
  return { processChild, exited, diagnostics: () => diagnostics };
}

function stopOwnedChild(handle) {
  const owned = handle.processChild;
  if (owned.exitCode !== null || owned.signalCode !== null || !owned.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(owned.pid), '/T', '/F'], {
      windowsHide: true, stdio: 'ignore',
    });
  } else {
    try { process.kill(-owned.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

function messageUntil(handle, type) {
  return Promise.race([
    new Promise(resolve => {
      const listener = value => {
        if (value.type === type) {
          handle.processChild.off('message', listener);
          resolve(value);
        }
      };
      handle.processChild.on('message', listener);
    }),
    handle.exited.then(() => { throw new Error(`Child exited before ${type}`); }),
  ]);
}

export async function measureWorker(output) {
  if (!process.env.CI && os.freemem() <= 6 * 1024 ** 3) {
    throw new Error('Local measurement needs more than 6 GiB of free memory; use CI');
  }
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'branch-measure-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('BRANCH_') && !['NODE_OPTIONS', 'NODE_COMPILE_CACHE'].includes(key)));
  Object.assign(env, { BRANCH_HOME: path.join(scratch, 'home'),
    BRANCH_STATE_DIR: path.join(scratch, 'state'),
    BRANCH_CONFIG_PATH: path.join(scratch, 'config.json'),
    BRANCH_MEASURE_ROOT: scratch, BRANCH_TEST_FAST: '1',
    HOME: path.join(scratch, 'home'), USERPROFILE: path.join(scratch, 'home'),
    XDG_CONFIG_HOME: path.join(scratch, 'home/.config'),
    XDG_DATA_HOME: path.join(scratch, 'home/.local/share'),
    NODE_DISABLE_COMPILE_CACHE: '1', BRANCH_NO_RESPAWN: '1' });
  const handles = [];
  let failed = false;
  const deadline = setTimeout(() => {
    for (const handle of handles) stopOwnedChild(handle);
  }, 120_000);
  try {
    const gateway = child(path.join(root, 'scripts/measure-worker-gateway.mjs'), [], env,
      ['--import', pathToFileURL(path.join(engine, 'scripts/tsx.mjs')).href]);
    handles.push(gateway);
    const ready = await messageUntil(gateway, 'gateway-ready');
    const providerStarted = messageUntil(gateway, 'provider-started');
    const samples = [];
    const idleSamples = [];
    let idle = false;
    const started = performance.now();
    const worker = child(path.join(engine, 'dist/worker/worker.mjs'),
      ['--internal-worker-session'], env,
      ['--import', pathToFileURL(path.join(root, 'scripts/measure-worker-observer.mjs')).href]);
    handles.push(worker);
    worker.processChild.on('message', value => {
      if (value.type === 'worker-memory') {
        parseMemorySample(value);
        samples.push(value);
        if (idle) idleSamples.push(value);
      }
    });
    let stdout = '';
    const completed = new Promise((resolve, reject) => {
      worker.processChild.stdout.on('data', chunk => {
        stdout += chunk.toString();
        if (!stdout.includes('\n')) return;
        try {
          const result = JSON.parse(stdout.split('\n')[0]);
          assert.equal(result.result?.status, 'completed');
          assert.equal(result.retainWorker, true);
          assert.equal(result.retention, 'idle');
          resolve();
        } catch (error) { reject(error); }
      });
    });
    worker.processChild.stdin.write(JSON.stringify({ type: 'turn',
      turnId: ready.descriptor.assignment.turnId, descriptor: ready.descriptor, idleRetention: true }) + '\n');
    await Promise.race([providerStarted, worker.exited]);
    const startupMs = performance.now() - started;
    await Promise.race([completed, worker.exited]);
    idle = true;
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const proofReceived = messageUntil(gateway, 'gateway-proof');
    gateway.processChild.send({ type: 'finish' });
    const { type: _type, ...proof } = await proofReceived;
    worker.processChild.stdin.end();
    await Promise.all([worker.exited, gateway.exited]);
    const result = reportMeasurement({ platform: process.platform, arch: process.arch,
      startupMs, idleSamples, samples, proof });
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(formatMeasurement(result));
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, formatMeasurement(result));
    return result;
  } catch (error) {
    failed = true;
    // Private local debugging only; the public report never includes these logs.
    await fs.writeFile(path.join(scratch, 'diagnostics.log'), handles.map(h => h.diagnostics()).join('\n'));
    throw error;
  } finally {
    clearTimeout(deadline);
    for (const handle of handles) stopOwnedChild(handle);
    await Promise.allSettled(handles.map(h => h.exited));
    if (!failed) await fs.rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === 'build') await buildWorker();
  else if (process.argv[2] === 'run' && process.argv[3]) await measureWorker(path.resolve(process.argv[3]));
  else throw new Error('Usage: measure-worker.mjs build|run <report.json>');
}
