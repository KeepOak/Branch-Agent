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
const tile = path.join(mobileRoot, 'modules/home-widget/android/src/main/java/expo/modules/homewidget/TalkTileService.kt');
const tileIcon = path.join(mobileRoot, 'modules/home-widget/android/src/main/res/drawable/branch_talk_tile.xml');
const talkProvider = path.join(mobileRoot, 'modules/home-widget/android/src/main/java/expo/modules/homewidget/TalkWidgetProvider.kt');
const talkInfo = path.join(mobileRoot, 'modules/home-widget/android/src/main/res/xml/branch_talk_widget_info.xml');
const talkLayout = path.join(mobileRoot, 'modules/home-widget/android/src/main/res/layout/branch_talk_widget.xml');
const manifest = path.join(mobileRoot, 'modules/home-widget/android/src/main/AndroidManifest.xml');

type Plugin = string | [string, Record<string, unknown>];
const plugins = app.expo.plugins as Plugin[];

describe('the Android home-screen widget', () => {
  it('is wired through the Expo config plugin, not a committed android/ folder', () => {
    expect(plugins).toContain('./plugins/withHomeWidget.js');
    const gitignore = readFileSync(path.join(mobileRoot, '.gitignore'), 'utf8');
    expect(gitignore.split(/\r?\n/).map((line) => line.trim())).toContain('/android');
  });

  it('registers an AppWidgetProvider that opens Ask Branch', () => {
    for (const file of [pluginPath, provider, moduleKt, info, layout, manifest]) {
      expect(existsSync(file)).toBe(true);
    }
    const plugin = readFileSync(pluginPath, 'utf8');
    expect(plugin).toContain('expo.modules.homewidget.HomeWidgetProvider');
    expect(plugin).toContain('android.appwidget.action.APPWIDGET_UPDATE');
    expect(plugin).toContain('@xml/branch_home_widget_info');
    expect(plugin).toContain('@string/branch_home_widget_label');

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

  it('ships a Talk to Branch Quick Settings tile that opens Talk', () => {
    expect(existsSync(tile)).toBe(true);
    expect(existsSync(tileIcon)).toBe(true);
    const kotlin = readFileSync(tile, 'utf8');
    expect(kotlin).toContain('class TalkTileService : TileService()');
    expect(kotlin).toContain('ACTION_TALK');
    expect(kotlin).toContain('unlockAndRun');
    const mf = readFileSync(manifest, 'utf8');
    expect(mf).toContain('android.service.quicksettings.action.QS_TILE');
    expect(mf).toContain('android.permission.BIND_QUICK_SETTINGS_TILE');
    expect(readFileSync(path.join(mobileRoot, 'modules/home-widget/android/src/main/res/values/strings.xml'), 'utf8')).toContain(
      '<string name="branch_talk_tile_label">Talk to Branch</string>',
    );
  });

  it('adds the tile service only once on the generated app manifest', () => {
    const { ensureTalkTileService, TALK_TILE_CLASS } = require(pluginPath) as {
      ensureTalkTileService: (manifest: unknown) => {
        manifest: { application: Array<{ service: Array<{ $: Record<string, string> }> }> };
      };
      TALK_TILE_CLASS: string;
    };
    const empty = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const twice = ensureTalkTileService(ensureTalkTileService(empty));
    const services = twice.manifest.application[0].service;
    expect(services).toHaveLength(1);
    expect(services[0].$['android:name']).toBe(TALK_TILE_CLASS);
    expect(services[0].$['android:permission']).toBe('android.permission.BIND_QUICK_SETTINGS_TILE');
  });

  it('ships a small Talk to Branch widget that opens Talk', () => {
    for (const file of [talkProvider, talkInfo, talkLayout]) expect(existsSync(file)).toBe(true);
    const kotlin = readFileSync(talkProvider, 'utf8');
    expect(kotlin).toContain('class TalkWidgetProvider : AppWidgetProvider()');
    expect(kotlin).toContain('ACTION_TALK');
    expect(readFileSync(talkInfo, 'utf8')).toContain('android:widgetCategory="home_screen"');
    const talkXml = readFileSync(talkLayout, 'utf8');
    expect(talkXml).toContain('@string/branch_talk_tile_label');
    expect(talkXml).toContain('@drawable/branch_talk_tile');
    expect(readFileSync(manifest, 'utf8')).toContain('@xml/branch_talk_widget_info');
  });

  it('adds the Talk widget receiver only once, beside Ask Branch', () => {
    const { ensureHomeWidgetReceiver, ensureTalkWidgetReceiver, PROVIDER_CLASS, TALK_WIDGET_CLASS } = require(pluginPath) as {
      ensureHomeWidgetReceiver: (manifest: unknown) => unknown;
      ensureTalkWidgetReceiver: (manifest: unknown) => {
        manifest: { application: Array<{ receiver: Array<{ $: { 'android:name': string } }> }> };
      };
      PROVIDER_CLASS: string;
      TALK_WIDGET_CLASS: string;
    };
    const empty = { manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] } };
    const both = ensureTalkWidgetReceiver(ensureTalkWidgetReceiver(ensureHomeWidgetReceiver(empty)));
    expect(both.manifest.application[0].receiver.map((r) => r.$['android:name'])).toEqual([PROVIDER_CLASS, TALK_WIDGET_CLASS]);
  });
});
