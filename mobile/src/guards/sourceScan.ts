import fs from 'node:fs';
import path from 'node:path';

export const mobileRoot = path.resolve(__dirname, '../..');

const RAW_SCROLL = new Set(['ScrollView', 'FlatList', 'SectionList']);

/** CSS named colours (Level 4), minus transparent / currentColor which are not paints. */
const NAMED_COLORS = new Set([
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkgrey',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkslategrey',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dimgrey',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'grey',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightgrey',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightslategrey',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'rebeccapurple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'slategrey',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
]);

const HEX_RE = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const FUNC_RE = /\b(?:rgba?|hsla?)\s*\([^)]*\)/gi;
const QUOTED_WORD_RE = /(['"`])([a-z]+)\1/gi;

function walkFiles(absDir: string, exclude: (rel: string) => boolean, out: string[]): void {
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const full = path.join(absDir, entry.name);
    const rel = path.relative(mobileRoot, full).replace(/\\/g, '/');
    if (entry.isDirectory()) walkFiles(full, exclude, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !exclude(rel)) out.push(rel);
  }
}

/** App shell, screens, and shared UI. Tests are skipped; they are not what a person sees. */
export function uiSourceFiles(): string[] {
  const files = ['App.tsx'];
  walkFiles(path.join(mobileRoot, 'src/screens'), (rel) => /\.test\.(ts|tsx)$/.test(rel), files);
  walkFiles(path.join(mobileRoot, 'src/ui'), (rel) => /\.test\.(ts|tsx)$/.test(rel), files);
  return files.sort();
}

export function readMobileFile(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), 'utf8');
}

/** Drop comments so copy and notes cannot trip the colour or import scans. */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i += 1;
      while (i < n) {
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i] + source[i + 1];
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function namedBinding(part: string): string | null {
  const bit = part.trim();
  if (!bit || bit.startsWith('type ')) return null;
  return bit.split(/\s+as\s+/)[0]?.trim() ?? null;
}

/** Raw ScrollView / FlatList / SectionList imported from react-native (value imports, not types). */
export function rawScrollImports(source: string): string[] {
  const text = stripComments(source);
  const hits: string[] = [];
  const named = /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]react-native['"]/g;
  let match: RegExpExecArray | null;
  while ((match = named.exec(text))) {
    if (match[1]) continue;
    for (const part of match[2].split(',')) {
      const name = namedBinding(part);
      if (name && RAW_SCROLL.has(name)) hits.push(name);
    }
  }
  const mixed = /import\s+\w+\s*,\s*\{([^}]+)\}\s+from\s+['"]react-native['"]/g;
  while ((match = mixed.exec(text))) {
    for (const part of match[1].split(',')) {
      const name = namedBinding(part);
      if (name && RAW_SCROLL.has(name)) hits.push(name);
    }
  }
  const ns = /import\s+\*\s+as\s+(\w+)\s+from\s+['"]react-native['"]/g;
  while ((match = ns.exec(text))) {
    const prefix = match[1];
    for (const name of RAW_SCROLL) {
      if (new RegExp(`\\b${prefix}\\.${name}\\b`).test(text)) hits.push(`${prefix}.${name}`);
    }
  }
  return hits;
}

export type ColorHit = { kind: 'hex' | 'func' | 'named'; value: string };

/** Hex, rgb/rgba, hsl/hsla, or a quoted CSS named colour. `transparent` is allowed. */
export function colorLiterals(source: string): ColorHit[] {
  const text = stripComments(source);
  const hits: ColorHit[] = [];
  HEX_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEX_RE.exec(text))) hits.push({ kind: 'hex', value: match[0] });
  FUNC_RE.lastIndex = 0;
  while ((match = FUNC_RE.exec(text))) hits.push({ kind: 'func', value: match[0] });
  QUOTED_WORD_RE.lastIndex = 0;
  while ((match = QUOTED_WORD_RE.exec(text))) {
    const word = match[2].toLowerCase();
    if (NAMED_COLORS.has(word)) hits.push({ kind: 'named', value: match[0] });
  }
  return hits;
}

export function isGrayscaleColor(value: string): boolean {
  const trimmed = value.trim();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
    const r = Number.parseInt(h.slice(0, 2), 16);
    const g = Number.parseInt(h.slice(2, 4), 16);
    const b = Number.parseInt(h.slice(4, 6), 16);
    return r === g && g === b;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(trimmed);
  if (rgb) return Number(rgb[1]) === Number(rgb[2]) && Number(rgb[2]) === Number(rgb[3]);
  const rgbSpace = /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(trimmed);
  if (rgbSpace) return Number(rgbSpace[1]) === Number(rgbSpace[2]) && Number(rgbSpace[2]) === Number(rgbSpace[3]);
  const hsl = /^hsla?\(\s*[\d.]+\s*,\s*([\d.]+)%/i.exec(trimmed);
  if (hsl) return Number(hsl[1]) === 0;
  const hslSpace = /^hsla?\(\s*[\d.]+[^\S\n]+([\d.]+)%/i.exec(trimmed);
  if (hslSpace) return Number(hslSpace[1]) === 0;
  return false;
}

export function formatHits(file: string, values: string[]): string {
  return `${file}: ${values.join(', ')}`;
}
