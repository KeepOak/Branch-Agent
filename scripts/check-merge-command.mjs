// Check that merge commands in documentation use the correct pattern.
// Enforces: gh pr merge must include --merge and --match-head-commit, never --squash or --rebase.
// Also checks REST API merge calls use merge_method: "merge" and sha.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const docsToCheck = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  '.cursor/BUGBOT.md',
  'docs/CHECKPOINT.md',
];

// Read the quoted value assigned to a JSON-like field in a lookahead window.
// Matches merge_method: "merge" and "merge_method":"merge", not a nearby mention.
export function assignedFieldValue(context, field) {
  const pattern = new RegExp(
    String.raw`["']?${field}["']?\s*[:=]\s*["']([^"']+)["']`,
  );
  const match = context.match(pattern);
  return match ? match[1] : null;
}

export function checkMergeCommands(rootDir = root, docs = docsToCheck) {
  let failed = false;

  for (const doc of docs) {
    const file = path.join(rootDir, doc);
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // file doesn't exist, skip
  }

  // Check gh pr merge commands
  const mergeCommands = content.matchAll(/gh pr merge[^\n]*/g);
  
  for (const match of mergeCommands) {
    const cmd = match[0];
    
    // Must have --merge
    if (!cmd.includes('--merge')) {
      console.error(`${doc}: merge command missing --merge:`);
      console.error(`  ${cmd}`);
      failed = true;
    }
    
    // Must have --match-head-commit
    if (!cmd.includes('--match-head-commit')) {
      console.error(`${doc}: merge command missing --match-head-commit:`);
      console.error(`  ${cmd}`);
      failed = true;
    }
    
    // Must not have --squash, --rebase, or --auto
    if (cmd.includes('--squash')) {
      console.error(`${doc}: merge command must not use --squash:`);
      console.error(`  ${cmd}`);
      failed = true;
    }
    
    if (cmd.includes('--rebase')) {
      console.error(`${doc}: merge command must not use --rebase:`);
      console.error(`  ${cmd}`);
      failed = true;
    }

    if (cmd.includes('--auto')) {
      console.error(`${doc}: merge command must not use --auto:`);
      console.error(`  ${cmd}`);
      failed = true;
    }
  }
  
  // Check REST API merge calls
  const apiMergeCalls = content.matchAll(/PUT \/repos\/[^\s]+\/pulls\/[^\s]+\/merge[^\n]*/gi);
  
  for (const match of apiMergeCalls) {
    const call = match[0];
    // Look ahead in the content for the merge_method
    const contextStart = match.index;
    const contextEnd = Math.min(contextStart + 300, content.length);
    const context = content.slice(contextStart, contextEnd);
    
    const mergeMethod = assignedFieldValue(context, 'merge_method');
    if (mergeMethod === 'squash') {
      console.error(`${doc}: REST API merge call must not use merge_method: "squash":`);
      console.error(`  ${call}`);
      failed = true;
    } else if (mergeMethod === 'rebase') {
      console.error(`${doc}: REST API merge call must not use merge_method: "rebase":`);
      console.error(`  ${call}`);
      failed = true;
    } else if (mergeMethod !== 'merge') {
      console.error(`${doc}: REST API merge call must specify merge_method: "merge":`);
      console.error(`  ${call}`);
      failed = true;
    }

    // Must specify sha as an assigned field, not just the word nearby
    if (!assignedFieldValue(context, 'sha')) {
      console.error(`${doc}: REST API merge call must specify sha parameter:`);
      console.error(`  ${call}`);
      failed = true;
    }
  }
}

  if (failed) {
    console.error('\nMerge commands must use: gh pr merge <n> --merge --match-head-commit <sha>');
    console.error('Or REST API: PUT /repos/KeepOak/Branch-Agent/pulls/<n>/merge with merge_method: "merge" and sha');
    return false;
  } else {
    return true;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const passed = checkMergeCommands();
  if (!passed) process.exit(1);
  console.log('All merge commands follow the correct pattern.');
}
