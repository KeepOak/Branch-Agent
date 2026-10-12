import { expect, it } from "vitest";
import { splitArgsPreservingQuotes } from "./arg-split.js";
import {
  buildSystemdUnit,
  parseSystemdEnvAssignments,
  parseSystemdExecStart,
  renderSystemdEnvAssignment,
  splitSystemdLogicalLines,
} from "./systemd-unit.js";

const values = ["plain", 'mix \\ and " here', "trailing\\", "apostrophe's", "'quoted'"];
const execStart = (unit: string) =>
  unit
    .split("\n")
    .find((line) => line.startsWith("ExecStart="))
    ?.slice("ExecStart=".length) ?? "";

it("preserves comments, escaped backslashes, and continuation boundaries for LF and CRLF", () => {
  const command = "ExecStart=/usr/bin/branch gateway run";
  const cases = [
    [
      ["# note \\", "; note \\", command],
      ["# note \\", "; note \\", command],
    ],
    [
      ['Environment="SETTING=one\\', " # note \\", " ; note", '  two"'],
      ['Environment="SETTING=one   two"'],
    ],
    [
      ["Environment=SETTING=one\\\\", command],
      ["Environment=SETTING=one\\\\", command],
    ],
    [
      ["Environment=SETTING=one\\", "", command],
      ["Environment=SETTING=one ", command],
    ],
    [["Environment=SETTING=one\\", " # note"], ["Environment=SETTING=one "]],
  ] as const;
  for (const [input, expected] of cases) {
    for (const separator of ["\n", "\r\n"]) {
      expect(splitSystemdLogicalLines(input.join(separator))).toEqual(expected);
    }
  }
});

it("round-trips escaped and quoted Environment values", () => {
  for (const value of values) {
    expect(parseSystemdEnvAssignments(renderSystemdEnvAssignment("BRANCH_TOKEN", value))).toEqual(
      [{ key: "BRANCH_TOKEN", value }],
    );
  }
});

it("round-trips escaped and quoted ExecStart arguments", () => {
  const programArguments = ["/usr/bin/branch", "gateway", ...values];
  const unit = buildSystemdUnit({
    description: "Branch Agent Gateway",
    programArguments,
    environment: {},
  });
  expect(parseSystemdExecStart(execStart(unit))).toEqual(programArguments);
});

it("preserves explicit NODE_OPTIONS while omitting other empty values", () => {
  for (const nodeOptions of ["", "--max-old-space-size=24576"]) {
    const programArguments = ["/usr/bin/node", "--max-old-space-size=16384", "gateway.js"];
    const unit = buildSystemdUnit({
      programArguments,
      environment: { NODE_OPTIONS: nodeOptions, UNUSED: "", MISSING: undefined },
    });
    expect(
      unit
        .split("\n")
        .filter((line) => line.startsWith("Environment="))
        .flatMap((line) => parseSystemdEnvAssignments(line.slice("Environment=".length))),
    ).toEqual([{ key: "NODE_OPTIONS", value: nodeOptions }]);
    expect(parseSystemdExecStart(execStart(unit))).toEqual(programArguments);
  }
});

it("renders the gateway unit with safe lifecycle policy and ordered environment directives", () => {
  const unit = buildSystemdUnit({
    description: "Branch Agent Gateway",
    programArguments: ["/usr/bin/branch", "gateway", "--name", "My Bot"],
    environmentFiles: ["/home/test/.branch/.env"],
    environment: { BRANCH_GATEWAY_PORT: "18789" },
  });
  for (const directive of [
    'ExecStart=/usr/bin/branch gateway --name "My Bot"',
    "KillMode=mixed",
    "TimeoutStopSec=330",
    "TimeoutStartSec=30",
    "SuccessExitStatus=0 143",
    "OOMPolicy=continue",
    "StartLimitBurst=10",
    "StartLimitIntervalSec=300",
    "RestartSec=5",
    "RestartPreventExitStatus=78",
    "EnvironmentFile=-/home/test/.branch/.env",
    "Environment=BRANCH_GATEWAY_PORT=18789",
  ]) {
    expect(unit.split("\n")).toContain(directive);
  }
  expect(unit.indexOf("EnvironmentFile=-/home/test/.branch/.env")).toBeLessThan(
    unit.indexOf("Environment=BRANCH_GATEWAY_PORT=18789"),
  );
});

it("rejects environment values with line breaks", () => {
  expect(() =>
    buildSystemdUnit({
      description: "Branch Agent Gateway",
      programArguments: ["/usr/bin/branch", "gateway", "start"],
      environment: { INJECT: "ok\nExecStartPre=/bin/touch /tmp/oc15789_rce" },
    }),
  ).toThrow(/CR or LF/);
});

it("splits command arguments using the platform's escaping rules", () => {
  const cases = [
    [
      '/usr/bin/branch gateway start --name "My Bot"',
      "none",
      ["/usr/bin/branch", "gateway", "start", "--name", "My Bot"],
    ],
    [
      'branch --name "My \\"Bot\\"" --foo bar',
      "backslash",
      ["branch", "--name", 'My "Bot"', "--foo", "bar"],
    ],
    [
      'branch --path "C:\\\\Program Files\\\\Branch Agent"',
      "backslash-quote-only",
      ["branch", "--path", "C:\\\\Program Files\\\\Branch Agent"],
    ],
    [
      'branch --label "My \\"Quoted\\" Name"',
      "backslash-quote-only",
      ["branch", "--label", 'My "Quoted" Name'],
    ],
  ] as const;
  for (const [input, escapeMode, expected] of cases) {
    expect(
      splitArgsPreservingQuotes(input, escapeMode === "none" ? undefined : { escapeMode }),
    ).toEqual(expected);
  }
});

it("parses quoted assignments while preserving unquoted apostrophes", () => {
  expect(
    parseSystemdEnvAssignments("'BRANCH_GATEWAY_TOKEN=single quoted token' FOO=bar"),
  ).toEqual([
    { key: "BRANCH_GATEWAY_TOKEN", value: "single quoted token" },
    { key: "FOO", value: "bar" },
  ]);
  expect(parseSystemdEnvAssignments("FOO=can't BRANCH_GATEWAY_TOKEN=token")).toEqual([
    { key: "FOO", value: "can't" },
    { key: "BRANCH_GATEWAY_TOKEN", value: "token" },
  ]);
});
