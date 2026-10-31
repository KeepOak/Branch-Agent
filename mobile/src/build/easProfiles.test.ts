// Cloud-build profiles in eas.json. Android preview/production are sideload APKs signed with
// EAS-managed credentials; iOS is simulator-only. Local `npm run build:android` does not use these.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import eas from '../../eas.json';
import pkg from '../../package.json';

const root = path.join(__dirname, '../..');
const gitignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
const easText = readFileSync(path.join(root, 'eas.json'), 'utf8');

type AndroidProfile = { distribution?: string; buildType?: string };
type IosProfile = { simulator?: boolean; distribution?: string };
type BuildProfile = {
  developmentClient?: boolean;
  credentialsSource?: string;
  distribution?: string;
  android?: AndroidProfile;
  ios?: IosProfile;
};

const build = eas.build as Record<string, BuildProfile>;

describe('EAS build profiles', () => {
  it('names development, preview and production, and has no submit section', () => {
    expect(Object.keys(build).sort()).toEqual(['development', 'preview', 'production']);
    expect(eas).not.toHaveProperty('submit');
  });

  it('makes development a dev-client Android APK and an iOS simulator build', () => {
    expect(build.development.developmentClient).toBe(true);
    expect(build.development.android).toEqual({ distribution: 'internal', buildType: 'apk' });
    expect(build.development.ios).toEqual({ simulator: true });
    expect(build.development.distribution).toBeUndefined();
  });

  it('makes preview and production sideloadable Android APKs signed with remote credentials', () => {
    for (const name of ['preview', 'production'] as const) {
      expect(build[name].android).toEqual({ distribution: 'internal', buildType: 'apk' });
      expect(build[name].credentialsSource).toBe('remote');
      expect(build[name].distribution).toBeUndefined();
    }
  });

  it('keeps every iOS profile as a simulator build with no distribution', () => {
    for (const name of ['development', 'preview', 'production'] as const) {
      expect(build[name].ios).toEqual({ simulator: true });
      expect(build[name].ios?.distribution).toBeUndefined();
      expect(build[name].distribution).toBeUndefined();
    }
  });

  it('commits no store ids, team ids, emails, keystore paths or project ids', () => {
    expect(easText).not.toMatch(/appleTeamId|ascAppId|appleId|serviceAccountKeyPath|keystorePath|projectId|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  });

  it('ignores a local credentials file so a keystore cannot land in git', () => {
    expect(gitignore).toMatch(/^\s*\/credentials\.json\s*$/m);
    expect(gitignore).toMatch(/^\s*\/credentials\/\s*$/m);
  });

  it('leaves the local Android build as one command and does not add eas-cli', () => {
    expect(pkg.scripts['build:android' as keyof typeof pkg.scripts]).toBe('node scripts/build-android.mjs');
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('eas'))).toEqual([]);
  });
});
