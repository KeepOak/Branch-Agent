import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Each merge makes a few sequential gh API calls; one stalled call must not hang the merging Trunk.
const GH_COMMAND_TIMEOUT_MS = 60_000;
const SHA = /^[0-9a-f]{40}$/u;
const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
// Same verdict contract as src/infra/signal-wakes/signal-wake-classify.ts: the first line of the comment.
const VERDICT_LINE = /^branch-verdict:\s*(MERGE|FIX)\s+head=([0-9a-f]{40})(?:\s.*)?$/u;
// Every Trunk posts under one shared login, so the association is the gate.
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
export const REQUIRED_GATES = ["merge-gate", "merge-gate-trusted"];
export const MERGED_BY_KEY = "Merged-by";
// `Merged-by: agent:<id> ...` names the Trunk that merged. Anything else, including no trailer, is a person.
const AGENT_MERGED_BY = /^Merged-by:[ \t]*agent:([a-z0-9][a-z0-9_-]{0,63})(?:[ \t]|$)/mu;

function usage() {
  return `Usage: node scripts/merge-reviewed-pr.mjs <pr> --head <reviewed-sha> (--agent <agent-id> | --person) [--repo owner/repo] [--apply]

Merges a reviewed PR as a merge commit pinned to the reviewed head. Before merging it checks that the
PR is open and not a draft, its head is still the reviewed head, the newest trusted branch-verdict is
MERGE for that head, and merge-gate and merge-gate-trusted are green on it. The merge commit names who
merged: --agent records the merging Trunk, --person records a person. Defaults to dry-run.`;
}

export function parseArgs(argv, env = process.env) {
  const args = {
    agentId: /** @type {string | undefined} */ (undefined),
    apply: false,
    head: /** @type {string | undefined} */ (undefined),
    person: false,
    pr: /** @type {number | undefined} */ (undefined),
    repo: env.GITHUB_REPOSITORY || "KeepOak/Branch-Agent",
  };
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index] ?? "";
    };
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--dry-run") {
      args.apply = false;
    } else if (arg === "--repo") {
      args.repo = next();
    } else if (arg === "--head") {
      args.head = next().trim().toLowerCase();
    } else if (arg === "--agent") {
      args.agentId = next().trim().toLowerCase();
    } else if (arg === "--person") {
      args.person = true;
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (/^#?\d+$/u.test(arg) && args.pr === undefined) {
      args.pr = Number(arg.replace(/^#/u, ""));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (help) {
    return Object.assign(args, { help: true });
  }
  if (!args.pr) {
    throw new Error("A PR number is required");
  }
  if (!args.head || !SHA.test(args.head)) {
    throw new Error("--head must be the full 40-character reviewed head sha");
  }
  if (args.person === (args.agentId !== undefined)) {
    throw new Error("Name who is merging: --agent <agent-id> for a Trunk, or --person");
  }
  if (args.agentId !== undefined && !AGENT_ID.test(args.agentId)) {
    throw new Error(`Invalid agent id: ${args.agentId}`);
  }
  return args;
}

export function defaultRunGh(args, options = {}, params = {}) {
  const execFileSyncImpl = params.execFileSyncImpl ?? execFileSync;
  return execFileSyncImpl("gh", args, {
    encoding: "utf8",
    killSignal: "SIGKILL",
    stdio: options.input ? ["pipe", "pipe", "inherit"] : ["ignore", "pipe", "inherit"],
    timeout: GH_COMMAND_TIMEOUT_MS,
    windowsHide: true,
    ...(options.input ? { input: options.input } : {}),
  });
}

/** The newest trusted comment (highest id) whose first line is a verdict. */
export function latestBranchVerdict(comments) {
  let latest;
  for (const comment of comments) {
    if (!TRUSTED_ASSOCIATIONS.has(comment.author_association)) {
      continue;
    }
    const firstLine = (
      String(comment.body ?? "")
        .trim()
        .split("\n")[0] ?? ""
    ).trim();
    const match = VERDICT_LINE.exec(firstLine);
    if (match && (latest === undefined || comment.id > latest.id)) {
      latest = { id: comment.id, verdict: match[1], headSha: match[2] };
    }
  }
  return latest;
}

/** Gate names whose newest check run on the head is not a completed success. */
export function missingGates(checkRuns) {
  return REQUIRED_GATES.filter((name) => {
    const newest = checkRuns
      .filter((run) => run.name === name)
      .reduce((best, run) => (best === undefined || run.id > best.id ? run : best), undefined);
    return newest?.status !== "completed" || newest?.conclusion !== "success";
  });
}

/** The merge commit title and message. The Merged-by trailer records who merged. */
export function composeMergeRecord({ agentId, head, login, number, title }) {
  const who = agentId ? `agent:${agentId}` : "person";
  const account = login ? ` via GitHub @${login}` : "";
  return {
    commit_title: `Merge pull request #${number}: ${title}`,
    commit_message: [
      `Reviewed head ${head}; merge-gate green; merge-gate-trusted green; independent review branch-verdict: MERGE.`,
      "",
      `${MERGED_BY_KEY}: ${who}${account}`,
    ].join("\n"),
  };
}

/** Reads a merge commit message: the merging Trunk, or a person when no agent trailer is present. */
export function classifyMergeRecord(message) {
  const match = AGENT_MERGED_BY.exec(String(message ?? ""));
  return match ? { merger: "agent", agentId: match[1] } : { merger: "person" };
}

function ghJsonLines(runGh, args) {
  return runGh(args)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function planReviewedMerge(args, runGh = defaultRunGh) {
  const pull = JSON.parse(runGh(["api", `repos/${args.repo}/pulls/${args.pr}`]));
  if (pull.state !== "open" || pull.merged) {
    throw new Error(`#${args.pr} is not open`);
  }
  if (pull.draft) {
    throw new Error(`#${args.pr} is a draft`);
  }
  if (pull.head?.sha !== args.head) {
    throw new Error(
      `#${args.pr} head moved: reviewed ${args.head}, current ${pull.head?.sha}. Review the new head first.`,
    );
  }
  const comments = ghJsonLines(runGh, [
    "api",
    "--paginate",
    `repos/${args.repo}/issues/${args.pr}/comments?per_page=100`,
    "--jq",
    ".[] | {id, body, author_association}",
  ]);
  const verdict = latestBranchVerdict(comments);
  if (verdict?.verdict !== "MERGE" || verdict.headSha !== args.head) {
    const newest = verdict ? `${verdict.verdict} head=${verdict.headSha}` : "none";
    throw new Error(
      `#${args.pr} has no current branch-verdict: MERGE head=${args.head} (newest verdict: ${newest})`,
    );
  }
  const checkRuns = ghJsonLines(runGh, [
    "api",
    "--paginate",
    `repos/${args.repo}/commits/${args.head}/check-runs?per_page=100`,
    "--jq",
    ".check_runs[] | {id, name, status, conclusion}",
  ]);
  const notGreen = missingGates(checkRuns);
  if (notGreen.length > 0) {
    throw new Error(`#${args.pr} is not green on ${args.head}: ${notGreen.join(", ")}`);
  }
  const login = runGh(["api", "user", "--jq", ".login"]).trim();
  return {
    merge_method: "merge",
    sha: args.head,
    ...composeMergeRecord({
      agentId: args.agentId,
      head: args.head,
      login,
      number: args.pr,
      title: pull.title,
    }),
  };
}

export function runReviewedMerge(args, runGh = defaultRunGh, log = console.log) {
  const request = planReviewedMerge(args, runGh);
  log(`${request.commit_title}\n\n${request.commit_message}`);
  if (!args.apply) {
    log("dry-run only; pass --apply to merge");
    return { request };
  }
  const result = JSON.parse(
    runGh(["api", "-X", "PUT", `repos/${args.repo}/pulls/${args.pr}/merge`, "--input", "-"], {
      input: JSON.stringify(request),
    }),
  );
  if (!result.merged) {
    throw new Error(`GitHub did not merge #${args.pr}: ${result.message ?? "no reason given"}`);
  }
  log(`merged #${args.pr} as ${result.sha}`);
  return { request, result };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if ("help" in args) {
      console.log(usage());
      process.exit(0);
    }
    runReviewedMerge(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
}
