// Check that merge commands in documentation use the correct pattern.
// Enforces: gh pr merge must include --squash and --match-head-commit for coordinator merges.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const docsToCheck = [
  'AGENTS.md',
  'CONTRIBUTING.md',
  '.cursor/BUGBOT.md',
  'docs/CHECKPOINT.md',
];

let failed = false;

for (const doc of docsToCheck) {
  const file = path.join(root, doc);
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // file doesn't exist, skip
  }

  // Find all gh pr merge commands
  const mergeCommands = content.matchAll(/gh pr merge[^\n]*/g);
  
  for (const match of mergeCommands) {
    const cmd = match[0];
    
    // Allow --auto --merge for human workflow examples
    if (cmd.includes('--auto') && cmd.includes('--merge')) {
      continue;
    }
    
    // For coordinator/automated merges, require --squash and --match-head-commit
    if (!cmd.includes('--auto') && (!cmd.includes('--squash') || !cmd.includes('--match-head-commit'))) {
      console.error(`${doc}: merge command missing --squash or --match-head-commit:`);
      console.error(`  ${cmd}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\nMerge commands must use: gh pr merge <number> --squash --match-head-commit <sha>');
  process.exit(1);
} else {
  console.log('All merge commands follow the correct pattern.');
}
