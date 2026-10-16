import fs from 'node:fs';
import path from 'node:path';
import { missingFeatures, MOBILE_FEATURE_MAP } from './featureMap';
import { mobileRoot } from './sourceScan';

describe('mobile feature map', () => {
  it('lists every current screen and the working features on those screens', () => {
    const screens = MOBILE_FEATURE_MAP.filter((entry) => entry.kind === 'screen').map((entry) => entry.id);
    expect(screens).toEqual([
      'welcome-screen',
      'scan-screen',
      'enter-code-screen',
      'pairing-approval-screen',
      'pairing-refused-screen',
      'paired-screen',
      'chats-screen',
      'chat-screen',
      'approvals-screen',
      'agents-screen',
      'computers-screen',
      'settings-screen',
    ]);
    expect(MOBILE_FEATURE_MAP.filter((entry) => entry.kind === 'feature').length).toBeGreaterThan(0);
  });

  it('reports a listed screen or feature whose file or marker is gone', () => {
    const files = new Map(MOBILE_FEATURE_MAP.map((entry) => [entry.file, 'export function WelcomeScreen\n']));
    expect(
      missingFeatures([{ id: 'welcome-screen', kind: 'screen', title: 'Welcome', file: 'src/screens/WelcomeScreen.tsx', marker: 'export function WelcomeScreen' }], (file) => files.get(file) ?? null),
    ).toEqual([]);
    expect(
      missingFeatures([{ id: 'welcome-screen', kind: 'screen', title: 'Welcome', file: 'src/screens/WelcomeScreen.tsx', marker: 'export function WelcomeScreen' }], () => null),
    ).toEqual(['welcome-screen: removed file src/screens/WelcomeScreen.tsx (Welcome)']);
    expect(
      missingFeatures([{ id: 'pair-button', kind: 'feature', title: 'Pair with your computer', file: 'src/screens/WelcomeScreen.tsx', marker: 'testID="pair-button"' }], () => 'export function WelcomeScreen() { return null; }'),
    ).toEqual(['pair-button: removed marker in src/screens/WelcomeScreen.tsx (Pair with your computer)']);
  });

  it('fails if a listed screen or feature is removed', () => {
    const missing = missingFeatures(MOBILE_FEATURE_MAP, (file) => {
      const abs = path.join(mobileRoot, file);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    });
    expect(missing).toEqual([]);
  });
});
