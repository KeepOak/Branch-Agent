/**
 * @jest-environment node
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import app from '../../app.json';

const mobileRoot = path.join(__dirname, '../..');
const pluginPath = path.join(mobileRoot, 'plugins/withHomeWidget.js');
const provider = path.join(mobileRoot, 'modules/home-widget/android/src/main/java/expo/modules/homewidget/HomeWidgetProvider.kt');
const moduleKt = path.join(mobileRoot, 'modules/home-widget/android/src/main/java/expo/modules/homewidget/HomeWidgetModule.kt');
const info = path.join(mobileRoot, 'modules/home-widget/android/src/main/res/xml/branch_home_widget_info.xml');
const layout = path.join(mobileRoot, 'modules/home-widget/android/src/main/res/layout/branch_home_widget.xml');
const manifest = path.join(mobileRoot, 'modules/home-widget/android/src/main/AndroidManifest.xml');

type Plugin = string | [string, Record<string, unknown>];
const plugins = app.expo.plugins as Plugin[];

describe('the Android home-screen widget', () => {
  it('is wired through the Expo config plugin, not a committed android/ folder', () => {
    expect(plugins).toContain('./plugins/withHomeWidget.js');
    expect(existsSync(path.join(mobileRoot, 'android'))).toBe(false);
  });

  it('registers an AppWidgetProvider that opens Ask Branch', () => {
    for (const file of [pluginPath, provider, moduleKt, info, layout, manifest]) {
      expect(existsSync(file)).toBe(true);
    }
    const plugin = readFileSync(pluginPath, 'utf8');
    expect(plugin).toContain('expo.modules.homewidget.HomeWidgetProvider');
    expect(plugin).toContain('android.appwidget.action.APPWIDGET_UPDATE');
    expect(plugin).toContain('@xml/branch_home_widget_info');
    expect(plugin).toContain('Ask Branch');

    const kotlin = readFileSync(provider, 'utf8');
    expect(kotlin).toContain('class HomeWidgetProvider : AppWidgetProvider()');
    expect(kotlin).toContain('ACTION_ASK');
    expect(kotlin).not.toContain('UIApplicationWidget');
    expect(readFileSync(moduleKt, 'utf8')).toContain('Name("HomeWidget")');

    expect(readFileSync(info, 'utf8')).toContain('android:widgetCategory="home_screen"');
    expect(readFileSync(layout, 'utf8')).toContain('branch_home_widget_ask');
    expect(readFileSync(manifest, 'utf8')).toContain('android.appwidget.action.APPWIDGET_UPDATE');
  });

  it('adds the receiver only once on the generated app manifest', () => {
    const { ensureHomeWidgetReceiver, PROVIDER_CLASS } = require(pluginPath) as {
      ensureHomeWidgetReceiver: (manifest: unknown) => {
        manifest: { application: Array<{ receiver: Array<{ $: { 'android:name': string } }> }> };
      };
      PROVIDER_CLASS: string;
    };
    const empty = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const once = ensureHomeWidgetReceiver(empty);
    const twice = ensureHomeWidgetReceiver(once);
    expect(twice.manifest.application[0].receiver).toHaveLength(1);
    expect(twice.manifest.application[0].receiver[0].$['android:name']).toBe(PROVIDER_CLASS);
  });
});
