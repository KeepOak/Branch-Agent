// The pull request as it is now, read from the API. The event payload is a snapshot from when the event fired:
// a body edited after a push (the SELF-CHECK handover) is missing from it. CI checks read the live body instead.
import { execFileSync } from 'node:child_process';

export const LIVE_READ_ATTEMPTS = 4;
export const LIVE_READ_DELAYS_SECONDS = [5, 10, 20];

// Live mode when the repo, the PR number and a token are set. Local runs fall back to GITHUB_EVENT_PATH.
export function liveContext(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!env.REPO || !env.PR_NUMBER || !token) return null;
  return { repo: env.REPO, prNumber: env.PR_NUMBER, token };
}

function defaultRequest({ repo, prNumber, token }) {
  const out = execFileSync('gh', ['api', `repos/${repo}/pulls/${prNumber}`], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GH_TOKEN: token },
  });
  return JSON.parse(out);
}

// Retries a transient read, then throws: a caller must fail closed, never fall back to the payload.
export function readLivePullRequest(ctx, { request = defaultRequest, sleep = defaultSleep } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= LIVE_READ_ATTEMPTS; attempt += 1) {
    try {
      const pr = request(ctx);
      return {
        body: typeof pr?.body === 'string' ? pr.body : '',
        headRef: pr?.head?.ref ?? '',
        headSha: pr?.head?.sha ?? '',
      };
    } catch (error) {
      lastError = error;
      if (attempt < LIVE_READ_ATTEMPTS) sleep(LIVE_READ_DELAYS_SECONDS[attempt - 1]);
    }
  }
  throw new Error(`${String(lastError?.message ?? lastError).split('\n')[0]} (after ${LIVE_READ_ATTEMPTS} attempts)`);
}

function defaultSleep(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}
