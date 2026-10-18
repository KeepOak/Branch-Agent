import fs from 'node:fs';
import path from 'node:path';
import { mobileRoot } from './sourceScan';

/**
 * Inventory of working phone routes and features, loaded from mobile/feature-map.json.
 * The r50 rebuild must keep every listed route: the guard test fails if one disappears.
 */
export type FeatureRoute = {
  id: string;
  title: string;
  /** Path relative to mobile/. */
  file: string;
  /** Must still appear in that screen file. */
  marker: string;
  /** JSX render marker that must still appear in App.tsx (not a type or import). */
  route: string;
};

export type FeatureEntry = {
  id: string;
  title: string;
  file: string;
  marker: string;
};

export type FeatureMapFile = {
  routes: FeatureRoute[];
  features: FeatureEntry[];
};

export const FEATURE_MAP_PATH = 'feature-map.json';

export function loadFeatureMap(readFile: (file: string) => string | null = defaultRead): FeatureMapFile {
  const text = readFile(FEATURE_MAP_PATH);
  if (text === null) throw new Error(`missing ${FEATURE_MAP_PATH}`);
  return JSON.parse(text) as FeatureMapFile;
}

function defaultRead(file: string): string | null {
  const abs = path.join(mobileRoot, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

export function missingRoutes(
  routes: readonly FeatureRoute[],
  readFile: (file: string) => string | null,
  appSource: string | null,
): string[] {
  const missing: string[] = [];
  for (const entry of routes) {
    const source = readFile(entry.file);
    if (source === null) {
      missing.push(`${entry.id}: removed file ${entry.file} (${entry.title})`);
    } else if (!source.includes(entry.marker)) {
      missing.push(`${entry.id}: removed marker in ${entry.file} (${entry.title})`);
    }
    if (appSource === null) {
      missing.push(`${entry.id}: App.tsx is gone (${entry.title})`);
    } else if (!appSource.includes(entry.route)) {
      missing.push(`${entry.id}: removed route in App.tsx (${entry.title})`);
    }
  }
  return missing;
}

export function missingFeatures(
  entries: readonly FeatureEntry[],
  readFile: (file: string) => string | null,
): string[] {
  const missing: string[] = [];
  for (const entry of entries) {
    const source = readFile(entry.file);
    if (source === null) {
      missing.push(`${entry.id}: removed file ${entry.file} (${entry.title})`);
      continue;
    }
    if (!source.includes(entry.marker)) {
      missing.push(`${entry.id}: removed marker in ${entry.file} (${entry.title})`);
    }
  }
  return missing;
}
