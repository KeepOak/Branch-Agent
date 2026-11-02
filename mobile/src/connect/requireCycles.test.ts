/// <reference types="node" />
// Runs in Node under Jest: reads the app's files and loads Metro's config the way Metro does.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const { engineCyclePattern } = require('../../engine-modules') as { engineCyclePattern: RegExp };

const mobileRoot = path.resolve(__dirname, '..', '..');
const IMPORT = /(?:import|export)\s+(?!type\s)(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/g;

function resolveLocal(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every cycle among the app's own files reachable from its entry, following value imports only. */
function appCycles(entry: string): string[][] {
  const graph = new Map<string, string[]>();
  const visit = (file: string) => {
    if (graph.has(file)) return;
    const deps: string[] = [];
    graph.set(file, deps);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolveLocal(file, match[1]);
      if (target && target.startsWith(mobileRoot + path.sep) && !target.includes(`${path.sep}node_modules${path.sep}`)) deps.push(target);
    }
    deps.forEach(visit);
  };
  visit(entry);
  const cycles: string[][] = [];
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const walk = (file: string) => {
    state.set(file, 'open');
    stack.push(file);
    for (const dep of graph.get(file) ?? []) {
      if (state.get(dep) === 'open') cycles.push([...stack.slice(stack.indexOf(dep)), dep].map((f) => path.relative(mobileRoot, f)));
      else if (!state.has(dep)) walk(dep);
    }
    stack.pop();
    state.set(file, 'done');
  };
  walk(entry);
  return cycles;
}

describe('require cycles', () => {
  it('the app’s own files import each other without a cycle', () => {
    const cycles = appCycles(path.join(mobileRoot, 'index.ts'));
    expect(cycles).toEqual([]);
    // The walk really covers the app: the entry reaches the screens and the pairing code.
    expect(fs.readFileSync(path.join(mobileRoot, 'index.ts'), 'utf8')).toMatch(/from '\.\/App'/);
  });

  it('Metro leaves the engine packages out of its cycle warning, as it does node_modules, and only them', () => {
    for (const engineFile of ['../engine/packages/gateway-client/src/session-projection.ts', '..\\engine\\packages\\gateway-client\\src\\session-projection-run-event.ts']) {
      expect(engineCyclePattern.test(engineFile)).toBe(true);
    }
    for (const appFile of ['App.tsx', 'src/screens/ChatsScreen.tsx', 'src/connect/phoneGateway.ts', 'src/engine/packages.ts']) {
      expect(engineCyclePattern.test(appFile)).toBe(false);
    }
    // The real config, loaded by Node the way Metro loads it (Jest's module system can't load Expo's Metro config).
    const printed = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(JSON.stringify(require('./metro.config.js').resolver.requireCycleIgnorePatterns.map((p) => [p.source, p.flags])))"],
      { cwd: mobileRoot, encoding: 'utf8', windowsHide: true },
    );
    const patterns = (JSON.parse(printed) as Array<[string, string]>).map(([source, flags]) => new RegExp(source, flags));
    const ignored = (file: string) => patterns.some((pattern) => pattern.test(file));
    expect(ignored('../engine/packages/gateway-client/src/session-projection.ts')).toBe(true);
    expect(ignored('node_modules/react-native/index.js')).toBe(true);
    expect(ignored('src/screens/ChatsScreen.tsx')).toBe(false);
  });

  it('Metro watches window/src/stage so take-control can import the DOM-free gesture files', () => {
    const printed = execFileSync(
      process.execPath,
      ['-e', "process.stdout.write(JSON.stringify(require('./metro.config.js').watchFolders))"],
      { cwd: mobileRoot, encoding: 'utf8', windowsHide: true },
    );
    const folders = JSON.parse(printed) as string[];
    const stage = path.resolve(mobileRoot, '..', 'window', 'src', 'stage');
    expect(folders).toContain(stage);
  });

  it('Jest resolves Babel helpers from window/src/stage against this app’s node_modules', () => {
    const resolver = require('../../jest.resolver.js') as (
      request: string,
      options: { basedir: string; defaultResolver: (request: string, options: { basedir: string }) => string },
    ) => string;
    const windowStage = path.resolve(mobileRoot, '..', 'window', 'src', 'stage');
    const seen: Array<{ request: string; basedir: string }> = [];
    const defaultResolver = (request: string, options: { basedir: string }) => {
      seen.push({ request, basedir: options.basedir });
      return request;
    };
    resolver('@babel/runtime/helpers/interopRequireDefault', { basedir: windowStage, defaultResolver });
    expect(seen).toEqual([{ request: '@babel/runtime/helpers/interopRequireDefault', basedir: mobileRoot }]);
    seen.length = 0;
    resolver('./remote-map', { basedir: windowStage, defaultResolver });
    expect(seen).toEqual([{ request: './remote-map', basedir: windowStage }]);
  });
});
