// Guard docs/upstream/COPIED.csv: one header, six columns, no exact duplicate rows,
// and every file newly added to a Harvest list in this PR has a COPIED.csv row.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const copiedCsvPath = 'docs/upstream/COPIED.csv';
export const harvestDir = 'scripts/feature-batch-ci-harvest';
export const copiedHeader = 'branch_path,atlas_id,project,commit,upstream_path,date';
export const copiedColumns = copiedHeader.split(',');

export function parseCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else {
      field += char;
    }
  }
  fields.push(field);
  return fields;
}

export function harvestEntriesFrom(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(engine|window):(.+)$/.exec(line);
    if (!match) continue;
    entries.push(`${match[1]}/${match[2].trim()}`);
  }
  return entries;
}

export function checkCopiedCsv(text) {
  const errors = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index]) continue;
    records.push({ lineNumber: index + 1, line: lines[index], cols: parseCsvLine(lines[index]) });
  }
  const headers = records.filter((record) => record.cols[0] === 'branch_path');
  if (headers.length !== 1) {
    errors.push(`docs/upstream/COPIED.csv must have exactly one header row (found ${headers.length})`);
  } else if (headers[0].cols.length !== copiedColumns.length
    || copiedColumns.some((name, index) => headers[0].cols[index] !== name)) {
    errors.push(`docs/upstream/COPIED.csv header must be ${copiedHeader}`);
  }
  for (const record of records) {
    if (record.cols.length !== copiedColumns.length) {
      errors.push(`docs/upstream/COPIED.csv:${record.lineNumber} must have exactly ${copiedColumns.length} columns (found ${record.cols.length})`);
    }
  }
  const seen = new Map();
  for (const record of records) {
    const first = seen.get(record.line);
    if (first) {
      errors.push(`docs/upstream/COPIED.csv:${record.lineNumber} is an exact duplicate of line ${first}`);
    } else {
      seen.set(record.line, record.lineNumber);
    }
  }
  return {
    errors,
    branchPaths: new Set(records.filter((record) => record.cols[0] !== 'branch_path').map((record) => record.cols[0])),
  };
}

export function missingCopiedForAddedHarvest(addedHarvestFiles, branchPaths) {
  return [...addedHarvestFiles].filter((file) => !branchPaths.has(file)).sort();
}

export function checkCopiedAndHarvest({ csvText, headHarvest, baseHarvest }) {
  const copied = checkCopiedCsv(csvText);
  const errors = [...copied.errors];
  const added = new Set([...headHarvest].filter((file) => !baseHarvest.has(file)));
  for (const file of missingCopiedForAddedHarvest(added, copied.branchPaths)) {
    errors.push(`Harvest list added ${file} with no docs/upstream/COPIED.csv row`);
  }
  return errors;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function gitRefExists(cwd, ref) {
  try {
    git(['rev-parse', '--verify', ref], cwd);
    return true;
  } catch {
    return false;
  }
}

export function harvestEntriesOnDisk(cwd = root) {
  const entries = new Set();
  let names = [];
  try {
    names = readdirSync(path.join(cwd, harvestDir)).filter((name) => name.endsWith('.txt'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const name of names) {
    for (const entry of harvestEntriesFrom(readFileSync(path.join(cwd, harvestDir, name), 'utf8'))) {
      entries.add(entry);
    }
  }
  return entries;
}

export function harvestEntriesAt(ref, cwd = root) {
  const entries = new Set();
  if (!gitRefExists(cwd, ref)) return null;
  let listing = '';
  try {
    listing = git(['ls-tree', '--name-only', ref, `${harvestDir}/`], cwd);
  } catch {
    return entries;
  }
  for (const file of listing.split(/\r?\n/).filter((name) => name.endsWith('.txt'))) {
    try {
      for (const entry of harvestEntriesFrom(git(['show', `${ref}:${file}`], cwd))) entries.add(entry);
    } catch {
      // The list was removed or is unreadable at this ref.
    }
  }
  return entries;
}

export function reportCopiedCheck(cwd = root, base = process.env.COPIED_CHECK_BASE || 'HEAD^1') {
  const csvText = readFileSync(path.join(cwd, copiedCsvPath), 'utf8');
  const baseHarvest = harvestEntriesAt(base, cwd);
  const errors = checkCopiedAndHarvest({
    csvText,
    headHarvest: harvestEntriesOnDisk(cwd),
    baseHarvest: baseHarvest ?? new Set(),
  });
  return { errors, skippedHarvestDiff: baseHarvest === null, base };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, skippedHarvestDiff, base } = reportCopiedCheck();
  if (skippedHarvestDiff) {
    console.log(`COPIED.csv harvest-diff skipped: base ${base} is not available.`);
  }
  if (errors.length) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else {
    console.log('COPIED.csv and Harvest list additions look good.');
  }
}
