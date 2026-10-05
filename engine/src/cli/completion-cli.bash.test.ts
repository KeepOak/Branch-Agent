import "../test-utils/prepare-compiled-subprocesses.js";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import { registerCompletionCli } from "./completion-cli.js";
import {
  createDocumentedCompletionProgram,
  runGeneratedBashCompletion,
} from "./completion-cli.test-support.js";
import { createProgramContext } from "./program/context.js";
import { setProgramContext } from "./program/program-context.js";
import { quoteCliArg } from "./quote-cli-arg.js";

describe.skipIf(process.platform === "win32")("registered completion --shell bash", () => {
  let script: string;

  beforeAll(async () => {
    const program = new Command().name("branch");
    setProgramContext(program, createProgramContext());
    registerCompletionCli(program);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await withEnvAsync({ BRANCH_COMPLETION_SKIP_PLUGIN_COMMANDS: "1" }, () =>
        program.parseAsync(["completion", "--shell", "bash"], { from: "user" }),
      );
      script = stdout.mock.calls.map(([chunk]) => chunk.toString()).join("");
    } finally {
      stdout.mockRestore();
    }
  });

  describe.each(process.platform === "darwin" ? ["/bin/bash", "bash"] : ["bash"])(
    "%s callback",
    (bashPath) => {
      it.each([
        [["branch", "cron", "show", "--", "--j"], []],
        [["branch", "completion", "--", "--shell", "f"], []],
        [["branch", "--", "g"], ["gateway"]],
        [["branch", "cron", "--", "sh"], ["show"]],
        [["branch", "capability", "--", "emb"], ["embedding"]],
        [["branch", "gateway", "--token", "--", "status", "--j"], ["--json"]],
        [["branch", "gateway", "--token=--", "status", "--j"], ["--json"]],
        [["branch", "completion", "-ys", "--", "--s"], ["--shell"]],
        [["branch", "completion", "-ysbash", "--", "--s"], []],
        [["branch", "message", "send", "-mt", "--", "--j"], []],
        [["branch", "gateway", "stability", "--bundle", "--", "--j"], []],
        [["branch", "gateway", "stability", "--bundle", "latest", "--", "--j"], []],
        [["branch", "gateway", "stability", "--bundle", "--token", "--", "--j"], ["--json"]],
        [["branch", "cron", "show", "'--'", "--j"], []],
        [["branch", "cron", "show", "\\--", "--j"], []],
      ])("honors option operands and terminators in %j", (words, expected) => {
        const result = spawnSync(bashPath, ["--noprofile", "--norc"], {
          encoding: "utf8",
          input: `${script}
COMP_WORDS=(${words.map(quoteCliArg).join(" ")})
COMP_CWORD=${words.length - 1}
COMP_LINE=${quoteCliArg(words.join(" "))}
COMP_POINT=\${#COMP_LINE}
_branch_completion branch "\${COMP_WORDS[COMP_CWORD]}"
printf '%s\\n' "\${COMPREPLY[@]}"
`,
        });
        expect(result.error).toBeUndefined();
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        expect(result.stdout.split("\n").filter(Boolean)).toEqual(expected);
      });
    },
  );
});

describe("completion-cli native Bash words", () => {
  it.skipIf(process.platform !== "darwin")("uses macOS Bash byte offsets in a UTF-8 locale", () => {
    const prefix = "branch gateway --token=é status --j";

    expect(
      runGeneratedBashCompletion(
        createDocumentedCompletionProgram(),
        ["branch", "gateway", "--token=é", "status", "--json"],
        {
          line: `${prefix}son`,
          word: "--j",
          point: Buffer.byteLength(prefix),
          bashPath: "/bin/bash",
          env: { ...process.env, LC_ALL: "en_US.UTF-8" },
        },
      ),
    ).toEqual(["--json"]);
  });

  it.skipIf(process.platform === "win32").each([
    {
      line: "branch completion --shell=",
      words: ["branch", "completion", "--shell", "="],
      word: "",
      expected: ["zsh", "bash", "powershell", "fish"],
    },
    {
      line: "branch --profile=gateway completion --shell f",
      words: ["branch", "--profile", "=", "gateway", "completion", "--shell", "f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "branch completion --shell=f",
      words: ["branch", "completion", "--shell=f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "branch completion --shell=fish",
      words: ["branch", "completion", "--shell", "=", "fish"],
      word: "f",
      point: 29,
      expected: ["fish"],
    },
    {
      line: "branch completion --shell=fish",
      words: ["branch", "completion", "--shell=fish"],
      word: "f",
      point: 29,
      expected: ["fish"],
    },
    {
      line: "branch completion --shell=fish",
      words: ["branch", "completion", "--shell", "=", "fish"],
      word: "",
      point: 28,
      expected: ["zsh", "bash", "powershell", "fish"],
    },
    {
      line: "branch completion --shell=bogus",
      words: ["branch", "completion", "--shell", "=", "bogus"],
      word: "b",
      point: 29,
      expected: ["bash"],
    },
    {
      line: "branch completion --sh=fish",
      words: ["branch", "completion", "--sh=fish"],
      word: "--sh",
      point: 24,
      expected: ["--shell"],
    },
    {
      line: "branch completion -ysfish",
      words: ["branch", "completion", "-ysfish"],
      word: "-ysf",
      point: 24,
      expected: ["-ysfish"],
    },
    {
      line: "branch --profile=gateway completion --shell=fish --yes",
      words: [
        "branch",
        "--profile",
        "=",
        "gateway",
        "completion",
        "--shell",
        "=",
        "fish",
        "--yes",
      ],
      word: "f",
      point: 47,
      cword: 7,
      expected: ["fish"],
    },
    {
      line: "branch completion --shell=fish",
      words: ["branch", "completion", "--shell=fish"],
      word: "comple",
      point: 15,
      cword: 1,
      expected: ["completion"],
    },
    {
      line: "branch gateway --token = status --j",
      words: ["branch", "gateway", "--token", "=", "status", "--j"],
      word: "--j",
      expected: ["--json"],
    },
    {
      line: "branch completion>/dev/null --shell f",
      words: ["branch", "completion", ">", "/dev/null", "--shell", "f"],
      word: "f",
      expected: ["fish"],
    },
    {
      line: "branch gateway --token=prefix:status --f",
      words: ["branch", "gateway", "--token", "=", "prefix", ":", "status", "--f"],
      word: "--f",
      expected: ["--force"],
    },
    {
      line: "branch gateway --token=foo==status --f",
      words: ["branch", "gateway", "--token", "=", "foo", "==", "status", "--f"],
      word: "--f",
      expected: ["--force"],
    },
    ...['"f', "'f", '"f"', "\\f", 'f"i'].map((value) => ({
      line: `branch completion --shell ${value}`,
      words: ["branch", "completion", "--shell", value],
      word: value === 'f"i' ? "i" : value === '"f' || value === "'f" ? "f" : value,
      expected: [value === 'f"i' ? "ish" : "fish"],
    })),
    ...['"', "'"].flatMap((quote) => [
      {
        line: `branch completion --shell=${quote}f`,
        words: ["branch", "completion", `--shell=${quote}f`],
        word: "f",
        expected: ["fish"],
      },
      {
        line: `branch completion --shell=${quote}f`,
        words: ["branch", "completion", "--shell", "=", `${quote}f`],
        word: "f",
        expected: ["fish"],
      },
      {
        line: `branch completion -s ${quote}f`,
        words: ["branch", "completion", "-s", `${quote}f`],
        word: "f",
        expected: ["fish"],
      },
    ]),
  ])("respects native Bash word boundaries in $line at $point", ({ words, expected, ...input }) => {
    const program = createDocumentedCompletionProgram().option("--profile <name>", "Profile");

    expect(runGeneratedBashCompletion(program, words, input)).toEqual(expected);
  });
});
