/**
 * @jest-environment node
 */
// CI generates ios/ with expo prebuild, so the unsigned simulator job has to live in
// app.json / the workflow / the check script, not in a committed Xcode project.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import app from '../../app.json';
import pkg from '../../package.json';

const root = path.join(__dirname, '../..');
const repo = path.join(root, '..');

describe('the iOS Simulator CI build', () => {
  it('has a bundle id so prebuild does not fall back to com.anonymous', () => {
    expect(app.expo.ios.bundleIdentifier).toBe('com.keepoak.branch');
    expect(app.expo.ios.bundleIdentifier).toBe(app.expo.android.package);
    expect(app.expo.ios.infoPlist.CFBundleDisplayName).toBe('Branch Agent');
  });

  it('builds with one command and no Apple account or EAS in the repo', () => {
    expect(pkg.scripts['build:ios' as keyof typeof pkg.scripts]).toBe('node scripts/ios-simulator-check.mjs');
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('eas'))).toEqual([]);
    const script = readFileSync(path.join(root, 'scripts/ios-simulator-check.mjs'), 'utf8');
    expect(script).toContain("expo', 'prebuild', '--platform', 'ios', '--clean'");
    expect(script).toContain('CODE_SIGNING_ALLOWED=NO');
    expect(script).toContain('CODE_SIGNING_REQUIRED=NO');
    expect(script).toContain('FORCE_BUNDLING=1');
    expect(script).toContain("simctl', 'launch'");
    expect(script).toContain("simctl', 'io'");
    expect(script).not.toMatch(/process\.env\.(APPLE_|EXPO_TOKEN|ASC_)/);
    expect(script).not.toMatch(/credentialsSource|eas-cli/);
  });

  it('the workflow is an unsigned macos-15 job with a 15-minute cap', () => {
    const yaml = readFileSync(path.join(repo, '.github/workflows/mobile-ios-simulator.yml'), 'utf8');
    expect(yaml).toMatch(/name:\s*Mobile iOS Simulator/);
    expect(yaml).toMatch(/name:\s*iOS Simulator/);
    expect(yaml).toMatch(/runs-on:\s*macos-15/);
    expect(yaml).toMatch(/timeout-minutes:\s*15/);
    expect(yaml).not.toMatch(/timeout-minutes:\s*(1[6-9]|[2-9]\d)/);
    expect(yaml).toMatch(/ios-simulator-screenshot/);
    expect(yaml).toMatch(/ios-simulator-app/);
    expect(yaml).toMatch(/ios-simulator-check\.mjs --ci/);
    expect(yaml).toMatch(/permissions:\s*\n\s+contents:\s*read/);
    expect(yaml).not.toMatch(/contents:\s*write/);
    expect(yaml).not.toMatch(/secrets\./);
    expect(yaml).not.toMatch(/appleTeamId|provisioning|EXPO_TOKEN/);
    expect(yaml).not.toMatch(/\$\{\{\s*env\.HOME\s*\}\}/);
    expect(yaml).toMatch(/path:\s*~\/Library\/Caches\/CocoaPods/);
    expect(yaml).toMatch(/cocoapods-v2-/);
    expect(yaml).toMatch(/ios-derived-v2-/);
    for (const action of yaml.matchAll(/uses:\s+\S+@([0-9a-f]+)/g)) {
      expect(action[1]).toMatch(/^[0-9a-f]{40}$/);
    }
    const script = readFileSync(path.join(root, 'scripts/ios-simulator-check.mjs'), 'utf8');
    expect(script).toContain('xcodebuild "$@" | xcbeautify');
    expect(script).toContain("-o', 'pipefail'");
    expect(script).not.toMatch(/spawnSync\(\s*['"]xcodebuild['"][\s\S]{0,400}?encoding:\s*['"]utf8['"]/);
  });
});
