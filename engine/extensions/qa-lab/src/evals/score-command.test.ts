// `branch qa score` end to end: real CLI registration, real trajectory exporter bundles and
// session transcripts on disk, real scorers and threshold gate. Only the judge lane is stubbed.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { QaRunnerCliContribution } from "branch/plugin-sdk/qa-runner-runtime";
import { exportTrajectoryBundleForTest } from "branch/plugin-sdk/sqlite-runtime-testing";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listQaRunnerCliContributions, runQaManualLane } = vi.hoisted(() => ({
  listQaRunnerCliContributions: vi.fn<() => QaRunnerCliContribution[]>(() => []),
  runQaManualLane: vi.fn(),
}));

vi.mock("branch/plugin-sdk/qa-runner-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/qa-runner-runtime")>()),
  listQaRunnerCliContributions,
}));

vi.mock("../manual-lane.runtime.js", () => ({ runQaManualLane }));

import { registerQaLabCli } from "../cli.js";
import { scoreStoredRunBatch } from "./score-traces.js";
import { checks } from "./checks.js";
import { createScorer, notScorable } from "./scorer.js";
import type { AgentScorerRun, ScorerRunOutputForAgent } from "./scorer-utils.js";
import { loadStoredScorerRuns } from "./trajectory-run.js";

type Entry = Record<string, unknown>;

function message(id: string, parentId: string | null, body: Entry): Entry {
  return { type: "message", id, parentId, timestamp: "2026-04-01T05:46:40.000Z", message: body };
}

function assistant(content: unknown[]): Entry {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4",
    stopReason: "stop",
    timestamp: 2,
  };
}

function toolResult(toolCallId: string, toolName: string, text: string, isError = false): Entry {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError,
    timestamp: 3,
  };
}

async function writeSession(file: string, entries: Entry[]) {
  const header = {
    type: "session",
    version: 3,
    id: path.basename(file, ".jsonl"),
    timestamp: "2026-04-01T05:46:39.000Z",
    cwd: path.dirname(file),
  };
  await fs.writeFile(file, `${[header, ...entries].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

/** A run that reads a file, fails one write, then answers. */
function readThenFailedWriteSession(): Entry[] {
  return [
    message("u1", null, { role: "user", content: "Summarise README.md", timestamp: 1 }),
    message(
      "a1",
      "u1",
      assistant([
        { type: "toolCall", id: "call_read", name: "read", arguments: { filePath: "README.md" } },
        { type: "toolCall", id: "call_write", name: "write", arguments: { filePath: "out.md" } },
      ]),
    ),
    message("t1", "a1", toolResult("call_read", "read", "README contents")),
    message("t2", "t1", toolResult("call_write", "write", "EACCES", true)),
    message("a2", "t2", assistant([{ type: "text", text: "The README describes Branch." }])),
  ];
}

describe("qa score", () => {
  let tmpDir: string;
  let program: Command;
  let stdout: string[];

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-qa-score-"));
    stdout = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      stdout.push(String(chunk));
      return true;
    });
    process.exitCode = undefined;
    runQaManualLane.mockReset();
    program = new Command();
    program.exitOverride();
    registerQaLabCli(program);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function parseQa(args: string[]) {
    await program.parseAsync(["node", "branch", "qa", ...args]);
  }

  it("reads a real exported trajectory bundle without double counting tool calls", async () => {
    const sessionFile = path.join(tmpDir, "session-1.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());
    const outputDir = path.join(tmpDir, "bundle");
    await exportTrajectoryBundleForTest({
      outputDir,
      sessionFile,
      sessionId: "session-1",
      workspaceDir: tmpDir,
    });

    const [stored] = await loadStoredScorerRuns([outputDir]);
    expect(stored?.source).toBe("trajectory-bundle");
    expect(stored?.sessionId).toBe("session-1");
    const run = stored?.run as AgentScorerRun;
    expect(run.input.inputMessages.map((entry) => entry.content.content)).toEqual([
      "Summarise README.md",
    ]);
    const invocations = run.output.flatMap((entry) => entry.content.toolInvocations ?? []);
    expect(invocations.map((entry) => [entry.toolName, entry.state])).toEqual([
      ["read", "result"],
      ["write", "output-error"],
    ]);
    expect(invocations[0]?.result).toBe("README contents");
    expect(invocations[1]?.errorText).toBe("EACCES");

    const maxCalls = await checks.maxToolCalls(2).run(run);
    expect(maxCalls.preprocessStepResult?.count).toBe(2);
    expect(maxCalls.score).toBe(1);
  });

  it("scores a stored run through the CLI and fails the gate below the threshold", async () => {
    const sessionFile = path.join(tmpDir, "session-1.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());
    const reportPath = path.join(tmpDir, "report.json");

    await parseQa([
      "score",
      "--repo-root",
      tmpDir,
      "--trajectory",
      sessionFile,
      "--scorer",
      "tool-order=read,write",
      "--scorer",
      "no-tool-errors",
      "--scorer",
      "includes=branch",
      "--threshold",
      "1",
      "--json",
      "--output",
      reportPath,
    ]);

    const report = JSON.parse(await fs.readFile(reportPath, "utf8")) as {
      pass: boolean;
      failures: string[];
      scorers: Array<{ spec: string; summary: { meanScore: number; gateFailures: number } }>;
    };
    expect(report.scorers.map((scorer) => [scorer.spec, scorer.summary.meanScore])).toEqual([
      ["tool-order=read,write", 1],
      ["no-tool-errors", 0],
      ["includes=branch", 1],
    ]);
    expect(report.pass).toBe(false);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toContain("no-tool-errors");
    expect(process.exitCode).toBe(1);
    expect(stdout.join("")).toContain(`QA score report: ${reportPath}`);
  });

  it("passes with --allow-failures and per-scorer thresholds, printing Markdown", async () => {
    const sessionFile = path.join(tmpDir, "session-1.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());

    await parseQa([
      "score",
      "--trajectory",
      sessionFile,
      "--scorer",
      "called-tool=read",
      "--scorer",
      "no-tool-errors",
      "--threshold",
      "called-tool=1",
      "--allow-failures",
    ]);

    const markdown = stdout.join("");
    expect(markdown).toContain("# Branch QA Score Report");
    expect(markdown).toContain("| called-tool=read | >= 1 | 1 | 1.000 | 0 | 0 | 0 |");
    expect(markdown).toContain("| no-tool-errors | none | 1 | 0.000 | 0 | 0 | 0 |");
    expect(process.exitCode).toBeUndefined();
  });

  it("scores a folder of stored runs in order", async () => {
    await writeSession(path.join(tmpDir, "a.jsonl"), readThenFailedWriteSession());
    await writeSession(path.join(tmpDir, "b.jsonl"), [
      message("u1", null, { role: "user", content: "hi", timestamp: 1 }),
      message("a1", "u1", assistant([{ type: "text", text: "hello" }])),
    ]);

    await parseQa(["score", "--trajectory", tmpDir, "--scorer", "used-no-tools", "--json"]);

    const report = JSON.parse(stdout.join("")) as {
      scorers: Array<{ results: Array<{ sourcePath: string; score: { score: number } }> }>;
    };
    expect(report.scorers[0]?.results.map((row) => [path.basename(row.sourcePath), row.score.score])).toEqual([
      ["a.jsonl", 0],
      ["b.jsonl", 1],
    ]);
  });

  it("grades a coding session from exec exit codes recorded in tool result details", async () => {
    const sessionFile = path.join(tmpDir, "coding.jsonl");
    const execResult = (id: string, text: string, exitCode: number): Entry => ({
      ...toolResult(id, "exec", text),
      details: { status: "completed", exitCode },
    });
    await writeSession(sessionFile, [
      message("u1", null, { role: "user", content: "Fix the build", timestamp: 1 }),
      message(
        "a1",
        "u1",
        assistant([
          { type: "toolCall", id: "r1", name: "read", arguments: { path: "src/a.ts" } },
          { type: "toolCall", id: "e1", name: "edit", arguments: { path: "src/a.ts", oldText: "x" } },
          { type: "toolCall", id: "b1", name: "exec", arguments: { command: "pnpm tsc --noEmit" } },
          { type: "toolCall", id: "t1", name: "exec", arguments: { command: "pnpm vitest run" } },
        ]),
      ),
      message("x1", "a1", toolResult("r1", "read", "const x = 1;")),
      message("x2", "x1", toolResult("e1", "edit", "Edited src/a.ts")),
      message("x3", "x2", execResult("b1", "", 0)),
      message("x4", "x3", execResult("t1", "1 failed (Command exited with code 1)", 1)),
      message("a2", "x4", assistant([{ type: "text", text: "Build passes; one test still fails." }])),
    ]);

    await parseQa([
      "score",
      "--trajectory",
      sessionFile,
      "--scorer",
      "coding-outcome",
      "--scorer",
      "coding-efficiency",
      "--json",
    ]);

    const report = JSON.parse(stdout.join("")) as {
      scorers: Array<{ results: Array<{ score: { score: number; reason: string } }> }>;
    };
    const outcome = report.scorers[0]?.results[0]?.score;
    // build 1 (0.3), tests 0 (0.25), tool errors 1 (0.2), loops 1, regression 1, autonomy 1 (0.25)
    expect(outcome?.score).toBe(0.75);
    expect(outcome?.reason).toContain("Build (30%): Build/typecheck passed [1]");
    expect(outcome?.reason).toContain("Tests (25%): Tests failed (exit 1) [0]");
    const efficiency = report.scorers[1]?.results[0]?.score;
    expect(efficiency?.score).toBe(1);
    expect(efficiency?.reason).toContain("All 1 edits had prior reads");
  });

  it("routes LLM-judged scorers through the QA judge lane", async () => {
    const sessionFile = path.join(tmpDir, "session-1.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());
    runQaManualLane
      .mockResolvedValueOnce({ reply: '{"claims": ["The README describes Branch."]}' })
      .mockResolvedValueOnce({
        reply: ["```json", '{"verdicts": [{"verdict": "yes", "reason": "in README"}]}', "```"].join(
          String.fromCharCode(10),
        ),
      })
      .mockResolvedValueOnce({ reply: "Supported by the README tool result." });

    await parseQa([
      "score",
      "--trajectory",
      sessionFile,
      "--scorer",
      "faithfulness",
      "--judge-model",
      "openai/gpt-5.4",
      "--json",
    ]);

    const report = JSON.parse(stdout.join("")) as {
      scorers: Array<{ results: Array<{ score: { score: number; reason: string } }> }>;
    };
    expect(report.scorers[0]?.results[0]?.score).toMatchObject({
      score: 1,
      reason: "Supported by the README tool result.",
    });
    expect(runQaManualLane).toHaveBeenCalledTimes(3);
    expect(runQaManualLane.mock.calls[0]?.[0]).toMatchObject({
      providerMode: "live-frontier",
      primaryModel: "openai/gpt-5.4",
      alternateModel: "openai/gpt-5.4",
    });
    // The analyze prompt carries the run's tool result as context.
    expect(String(runQaManualLane.mock.calls[1]?.[0]?.message)).toContain("README contents");
  });

  it("requires a judge model for LLM-judged scorers", async () => {
    const sessionFile = path.join(tmpDir, "s.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());
    await expect(parseQa(["score", "--trajectory", sessionFile, "--scorer", "toxicity"])).rejects.toThrow(
      "--scorer toxicity uses an LLM judge; pass --judge-model <provider/model>.",
    );
    expect(runQaManualLane).not.toHaveBeenCalled();
  });

  it("rejects unknown scorers and invalid thresholds", async () => {
    const sessionFile = path.join(tmpDir, "s.jsonl");
    await writeSession(sessionFile, readThenFailedWriteSession());
    await expect(parseQa(["score", "--trajectory", sessionFile, "--scorer", "nope"])).rejects.toThrow(
      'Unknown scorer "nope"',
    );
    await expect(
      parseQa(["score", "--trajectory", sessionFile, "--scorer", "no-tool-errors", "--threshold", "1.5"]),
    ).rejects.toThrow(/between 0 and 1/);
  });
});

describe("scoreStoredRunBatch", () => {
  const output: ScorerRunOutputForAgent = [];
  const target = (sourcePath: string) => ({
    sourcePath,
    source: "session-transcript" as const,
    run: {
      input: { inputMessages: [], rememberedMessages: [], systemMessages: [], taggedSystemMessages: {} },
      output,
    },
  });

  it("returns ordered results, reports not-scorable separately, and isolates failures", async () => {
    let calls = 0;
    const scorer = createScorer<AgentScorerRun["input"], ScorerRunOutputForAgent>({
      id: "mixed",
      description: "mixed outcomes",
    })
      .preprocess(() => {
        calls += 1;
        if (calls === 2) {
          return notScorable("nothing to grade");
        }
        if (calls === 3) {
          throw new Error("scorer exploded");
        }
        return { ok: true };
      })
      .generateScore(() => 0.75);

    const results = await scoreStoredRunBatch({
      scorer,
      targets: [target("one"), target("two"), target("three"), target("four")],
      concurrency: 1,
      now: () => new Date("2026-10-04T00:00:00.000Z"),
    });

    expect(results.map((row) => row.index)).toEqual([0, 1, 2, 3]);
    expect(results[0]).toMatchObject({
      ok: true,
      score: { scorerId: "mixed", score: 0.75, scoreSource: "TRACE", createdAt: "2026-10-04T00:00:00.000Z" },
    });
    expect(results[1]).toMatchObject({ ok: true, notScorable: { step: "preprocess", reason: "nothing to grade" } });
    expect(results[2]).toMatchObject({ ok: false, failedStep: "preprocess" });
    expect(results[3]).toMatchObject({ ok: true, score: { score: 0.75 } });
    expect(calls).toBe(4);
  });
});
