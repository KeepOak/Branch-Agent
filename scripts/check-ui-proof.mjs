import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Check if a file path is a window UI source file (not a test or type-only file).
 * UI source files are .tsx/.ts files under window/ but excluding test files.
 */
export function isWindowUISource(filePath) {
  if (!filePath.startsWith('window/')) return false;
  if (!filePath.match(/\.(tsx?|jsx?)$/)) return false;
  if (filePath.match(/\.test\.(tsx?|jsx?)$/)) return false;
  if (filePath.match(/\.d\.ts$/)) return false;
  return true;
}

/**
 * Check if a PR body contains screenshot proof.
 * Valid proof includes:
 * - Markdown images: ![alt](url)
 * - HTML images: <img src="url" />
 * - Links to GitHub user-attachments or artifact images
 * - Explicit opt-out: "No visible change: <reason>"
 */
export function hasScreenshotProof(prBody) {
  if (!prBody) return false;

  // Check for opt-out
  if (/No visible change:/i.test(prBody)) return true;

  // Check for markdown images: ![alt](url)
  if (/!\[.*?\]\(.*?\)/.test(prBody)) return true;

  // Check for HTML images: <img ... src="..." />
  if (/<img\s+[^>]*src\s*=\s*["'][^"']+["'][^>]*>/i.test(prBody)) return true;

  // Check for GitHub user-attachments or artifact image links
  if (/https:\/\/(?:user-images\.githubusercontent\.com|github\.com\/.*\/assets\/)/i.test(prBody)) return true;

  return false;
}

/**
 * Main check function that returns an exit code and message.
 * Returns { exitCode: 0, message } on success.
 * Returns { exitCode: 1, message } on failure.
 */
export function checkUIProof(changedFiles, prBody) {
  const uiSourceFiles = changedFiles.filter(isWindowUISource);

  if (uiSourceFiles.length === 0) {
    return {
      exitCode: 0,
      message: 'No window UI source changes detected.'
    };
  }

  if (hasScreenshotProof(prBody)) {
    return {
      exitCode: 0,
      message: `Window UI changes (${uiSourceFiles.length} file(s)) have screenshot proof.`
    };
  }

  return {
    exitCode: 1,
    message: [
      `Window UI changes detected in ${uiSourceFiles.length} file(s), but no screenshot proof found in PR body:`,
      ...uiSourceFiles.map(f => `  - ${f}`),
      '',
      'Required: Add screenshots to the PR body showing the changes in action.',
      'Alternatively, add "No visible change: <reason>" if this is a refactor with no UI effect.',
      '',
      'See AGENTS.md rule 9: Self-test visible changes in a scratch engine and window',
      'and put screenshots in the PR.'
    ].join('\n')
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.url) {
  try {
    // When run from merge-gate, the GitHub event payload is available via environment
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
      console.error('Error: GITHUB_EVENT_PATH environment variable not set.');
      console.error('This script must be run in a GitHub Actions context.');
      process.exit(1);
    }

    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const prNumber = event.pull_request?.number;
    const prBody = event.pull_request?.body || '';

    if (!prNumber) {
      console.error('Error: Not a pull request event.');
      process.exit(1);
    }

    // Get changed files from the PR
    const changedFiles = event.pull_request?.changed_files_list || [];

    // If changed_files_list is not in the event, fall back to fetching via gh CLI
    let files = changedFiles;
    if (files.length === 0 && process.env.GITHUB_TOKEN) {
      const { execFileSync } = await import('node:child_process');
      const repo = process.env.GITHUB_REPOSITORY;
      const result = execFileSync('gh', ['pr', 'view', prNumber.toString(), '--repo', repo, '--json', 'files'],
        { encoding: 'utf8', windowsHide: true });
      const data = JSON.parse(result);
      files = data.files?.map(f => f.path) || [];
    }

    const result = checkUIProof(files, prBody);
    console.log(result.message);
    process.exit(result.exitCode);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}
