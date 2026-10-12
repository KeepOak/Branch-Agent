import "../src/test-utils/prepare-compiled-subprocesses.js";
import fs from "node:fs/promises";
import path from "node:path";
import { withTempHome } from "branch/plugin-sdk/test-env";
import { assert, describe, expect, it } from "vitest";
import { runBuiltCli } from "./cli-json-stdout.test-support.js";

describe("cli json stdout contract", () => {
  it.each([
    {
      name: "search with a leaf JSON flag",
      args: ["skills", "search", "fixture", "--json"],
      message: "Seedbank /api/v1/search failed (400): offline fixture",
    },
    {
      name: "search with a parent JSON flag",
      args: ["skills", "--json", "search", "fixture"],
      message: "Seedbank /api/v1/search failed (400): offline fixture",
    },
    {
      name: "list with a leaf JSON flag",
      args: ["skills", "list", "--agent", "", "--json"],
      message: "--agent must not be blank",
    },
    {
      name: "list with a parent JSON flag",
      args: ["skills", "--json", "list", "--agent", ""],
      message: "--agent must not be blank",
    },
    {
      name: "info with a leaf JSON flag",
      args: ["skills", "info", "fixture", "--agent", "", "--json"],
      message: "--agent must not be blank",
    },
    {
      name: "info with a parent JSON flag",
      args: ["skills", "--json", "info", "fixture", "--agent", ""],
      message: "--agent must not be blank",
    },
    {
      name: "check with a leaf JSON flag",
      args: ["skills", "check", "--agent", "", "--json"],
      message: "--agent must not be blank",
    },
    {
      name: "check with a parent JSON flag",
      args: ["skills", "--json", "check", "--agent", ""],
      message: "--agent must not be blank",
    },
    {
      name: "the default report after its agent flag",
      args: ["skills", "--agent", "", "--json"],
      message: "--agent must not be blank",
    },
    {
      name: "the default report before its agent flag",
      args: ["skills", "--json", "--agent", ""],
      message: "--agent must not be blank",
    },
    {
      name: "list with a configured remote Gateway missing its URL",
      args: ["skills", "list", "--json"],
      message: "gateway remote mode misconfigured: gateway.remote.url missing",
      remoteMissing: true,
    },
    ...[
      { name: "the default report", args: ["skills", "--json"] },
      { name: "list", args: ["skills", "list", "--json"] },
      { name: "info", args: ["skills", "info", "fixture", "--json"] },
      { name: "check", args: ["skills", "check", "--json"] },
      { name: "gardener status", args: ["skills", "gardener", "status", "--json"] },
      { name: "gardener pin", args: ["skills", "gardener", "pin", "fixture", "--json"] },
      { name: "gardener unpin", args: ["skills", "gardener", "unpin", "fixture", "--json"] },
      { name: "gardener restore", args: ["skills", "gardener", "restore", "fixture", "--json"] },
      {
        name: "workshop apply",
        args: ["skills", "workshop", "apply", "fixture-proposal", "--json"],
      },
    ].map(({ name, args }) => ({
      name: `${name} after an explicit environment Gateway fails`,
      args,
      message: "AUTOQA_SELECTED_GATEWAY_FAILURE",
      explicitGateway: true,
    })),
    {
      name: "retired gardener mutation",
      args: ["skills", "gardener", "pin", "missing-skill", "--json"],
      message:
        "Skill lifecycle curation is retired. The weekly collection review manages the skill collection; pin, unpin, and restore no longer exist.",
    },
    {
      name: "retired gardener mutation with parent JSON",
      args: ["skills", "gardener", "--json", "pin", "missing-skill"],
      message:
        "Skill lifecycle curation is retired. The weekly collection review manages the skill collection; pin, unpin, and restore no longer exist.",
    },
    {
      name: "workshop workspace validation with parent JSON",
      args: ["skills", "--json", "workshop", "list", "--agent", ""],
      message: "--agent must not be blank",
    },
    {
      name: "workshop mutation",
      args: ["skills", "workshop", "reject", "missing-proposal", "--json"],
      message: "Skill proposal not found: missing-proposal",
    },
    {
      name: "workshop inspection",
      args: ["skills", "workshop", "inspect", "missing-proposal", "--json"],
      message: "Skill proposal not found: missing-proposal",
    },
  ])("returns one canonical JSON document when skills $name fails", async (testCase) => {
    await withTempHome(
      async (tempHome) => {
        const configPath = path.join(tempHome, "missing-branch.json");
        if ("remoteMissing" in testCase) {
          await fs.writeFile(configPath, JSON.stringify({ gateway: { mode: "remote" } }));
        }
        const preload = `data:text/javascript,${encodeURIComponent(
          [
            'globalThis.fetch = async () => new Response("offline fixture", { status: 400 });',
            ...("explicitGateway" in testCase
              ? [
                  'import net from "node:net";',
                  'net.Socket.prototype.connect = function () { throw new Error("AUTOQA_SELECTED_GATEWAY_FAILURE"); };',
                ]
              : []),
          ].join("\n"),
        )}`;
        const result = runBuiltCli(
          tempHome,
          testCase.args,
          {
            BRANCH_STATE_DIR: path.join(tempHome, "isolated-state"),
            BRANCH_CONFIG_PATH: configPath,
            BRANCH_GATEWAY_PORT: "1",
            ...("explicitGateway" in testCase
              ? {
                  BRANCH_GATEWAY_URL: "ws://127.0.0.1:9",
                  BRANCH_GATEWAY_TOKEN: "fixture-token",
                }
              : {}),
          },
          { execArgv: [`--import=${preload}`] },
        );
        const message =
          "remoteMissing" in testCase
            ? [
                testCase.message,
                `Config: ${configPath}`,
                "Fix: set gateway.remote.url, or set gateway.mode=local.",
              ].join("\n")
            : testCase.message;

        expect(result.status, result.stderr).toBe(1);
        expect(JSON.parse(result.stdout)).toEqual({
          ok: false,
          error: {
            type: "cli_error",
            message,
          },
        });
        expect(result.stderr).toContain("[branch] The CLI command failed.");
        expect(result.stderr).not.toContain(message);
        expect(result.stderr.length).toBeLessThan(2_048);
      },
      { prefix: "branch-skills-json-failure-e2e-" },
    );
  });

  it.each([
    { name: "off", debug: "0", includesCause: false },
    { name: "on", debug: "1", includesCause: true },
  ])("keeps skills search nested causes behind debug mode ($name)", async (testCase) => {
    await withTempHome(
      async (tempHome) => {
        // Match the selected runtime's SyntaxError for the same malformed response.
        let syntaxError: unknown;
        try {
          JSON.parse("not-json");
        } catch (error) {
          syntaxError = error;
        }
        assert(syntaxError instanceof SyntaxError);
        const preload = `data:text/javascript,${encodeURIComponent(
          'globalThis.fetch = async () => new Response("not-json", { status: 200 });',
        )}`;
        const result = runBuiltCli(
          tempHome,
          ["skills", "search", "fixture"],
          {
            BRANCH_DEBUG: testCase.debug,
            BRANCH_STATE_DIR: path.join(tempHome, "isolated-state"),
            BRANCH_CONFIG_PATH: path.join(tempHome, "missing-branch.json"),
          },
          { execArgv: [`--import=${preload}`] },
        );

        expect(result.status, result.stderr).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain("Seedbank /api/v1/search returned malformed JSON");
        expect(result.stderr.includes(syntaxError.message)).toBe(testCase.includesCause);
      },
      { prefix: "branch-skills-human-failure-e2e-" },
    );
  });
});
