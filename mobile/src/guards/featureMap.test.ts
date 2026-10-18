import fs from 'node:fs';
import path from 'node:path';
import { loadFeatureMap, missingFeatures, missingRoutes } from './featureMap';
import { mobileRoot } from './sourceScan';

function readRepo(file: string): string | null {
  const abs = path.join(mobileRoot, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

describe('mobile feature map', () => {
  it('lists every current route in feature-map.json', () => {
    const { routes } = loadFeatureMap(readRepo);
    expect(routes.map((entry) => entry.id)).toEqual([
      'welcome',
      'scan',
      'code',
      'pairing-approval',
      'pairing-refused',
      'chats',
      'computers',
      'take-control',
      'computer',
      'agents',
      'chat',
      'voice',
      'approvals',
      'settings',
    ]);
  });

  it('reports a listed route whose file, marker or App.tsx wiring is gone', () => {
    const route = {
      id: 'voice',
      title: 'Voice',
      file: 'src/screens/VoiceScreen.tsx',
      marker: 'export function VoiceScreen',
      route: "{ name: 'voice'; row: ChatRow }",
    };
    const files = new Map([
      ['src/screens/VoiceScreen.tsx', 'export function VoiceScreen\n'],
      ['App.tsx', "type PairedRoute =\n  | { name: 'voice'; row: ChatRow }\n"],
    ]);
    const read = (file: string) => files.get(file) ?? null;
    expect(missingRoutes([route], read, files.get('App.tsx') ?? null)).toEqual([]);
    expect(missingRoutes([route], () => null, files.get('App.tsx') ?? null)).toEqual([
      'voice: removed file src/screens/VoiceScreen.tsx (Voice)',
    ]);
    expect(missingRoutes([route], read, null)).toEqual(['voice: App.tsx is gone (Voice)']);
    expect(missingRoutes([route], read, "type PairedRoute = { name: 'chats' }")).toEqual([
      'voice: removed route in App.tsx (Voice)',
    ]);
  });

  it('fails if a listed route disappears', () => {
    const map = loadFeatureMap(readRepo);
    expect(missingRoutes(map.routes, readRepo, readRepo('App.tsx'))).toEqual([]);
    expect(missingFeatures(map.features, readRepo)).toEqual([]);
  });
});
