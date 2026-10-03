// Route argument tests cover program route argument parsing and validation.
import { describe, expect, it } from "vitest";
import {
  parseAgentsListRouteArgs,
  parseChannelsListRouteArgs,
  parseChannelsStatusRouteArgs,
  parseConfigGetRouteArgs,
  parseConfigUnsetRouteArgs,
  parseGatewayHealthRouteArgs,
  parseGatewayStatusRouteArgs,
  parseHealthRouteArgs,
  parseModelsListRouteArgs,
  parseModelsStatusRouteArgs,
  parseSessionsRouteArgs,
  parseStatusRouteArgs,
} from "./route-args.js";

describe("route-args", () => {
  it("parses health and status route args", () => {
    expect(
      parseHealthRouteArgs(["node", "branch", "health", "--json", "--timeout", "5000"]),
    ).toEqual({
      json: true,
      verbose: false,
      timeoutMs: 5000,
    });
    expect(
      parseStatusRouteArgs([
        "node",
        "branch",
        "status",
        "--json",
        "--deep",
        "--all",
        "--usage",
        "--agent",
        "beta",
        "--timeout",
        "5000",
      ]),
    ).toEqual({
      json: true,
      deep: true,
      all: true,
      usage: true,
      agent: "beta",
      verbose: false,
      timeoutMs: 5000,
    });
    expect(parseStatusRouteArgs(["node", "branch", "status", "--timeout"])).toBeNull();
    expect(parseStatusRouteArgs(["node", "branch", "status", "--agent"])).toBeNull();
  });

  it("defers status/health --timeout with a present-but-invalid value to Commander", () => {
    // Regression: the route-first fast path used to silently accept invalid
    // --timeout values (0, negative, non-numeric, unit-suffixed) and run with
    // the default timeout, diverging from the full Commander path which rejects
    // them with a non-zero exit. Returning null defers to Commander so both
    // paths share the same validation.
    for (const bad of ["0", "-5", "nope", "5s"]) {
      expect(parseStatusRouteArgs(["node", "branch", "status", "--timeout", bad])).toBeNull();
      expect(parseHealthRouteArgs(["node", "branch", "health", "--timeout", bad])).toBeNull();
    }
    expect(
      parseStatusRouteArgs([
        "node",
        "branch",
        "status",
        "--timeout",
        "5000",
        "--timeout",
        "nope",
      ]),
    ).toBeNull();
    expect(
      parseHealthRouteArgs([
        "node",
        "branch",
        "health",
        "--timeout",
        "nope",
        "--timeout",
        "5000",
      ]),
    ).toMatchObject({ timeoutMs: 5000 });
    // A valid positive integer still parses on the fast path.
    expect(parseStatusRouteArgs(["node", "branch", "status", "--timeout", "5000"])).toMatchObject(
      { timeoutMs: 5000 },
    );
    // No --timeout flag at all still uses the fast path (undefined timeout).
    expect(parseStatusRouteArgs(["node", "branch", "status"])).toMatchObject({
      timeoutMs: undefined,
    });
  });

  it("defers command options placed before status or health to Commander", () => {
    expect(parseStatusRouteArgs(["node", "branch", "--json", "status"])).toBeNull();
    expect(parseHealthRouteArgs(["node", "branch", "--json", "health"])).toBeNull();
    expect(parseHealthRouteArgs(["node", "branch", "--verbose", "health"])).toBeNull();
    expect(parseHealthRouteArgs(["node", "branch", "--timeout=5000", "health"])).toBeNull();
    expect(parseHealthRouteArgs(["node", "branch", "--timeout", "5000", "health"])).toBeNull();
    expect(
      parseStatusRouteArgs(["node", "branch", "--profile", "work", "status", "--json"]),
    ).toMatchObject({ json: true });
  });

  it.each([
    {
      name: "health stray positional",
      parse: parseHealthRouteArgs,
      argv: ["node", "branch", "health", "extra"],
    },
    {
      name: "health flag terminator",
      parse: parseHealthRouteArgs,
      argv: ["node", "branch", "health", "--", "--json"],
    },
    {
      name: "sessions flag terminator",
      parse: parseSessionsRouteArgs,
      argv: ["node", "branch", "sessions", "--", "--json"],
    },
    {
      name: "agents list stray positional",
      parse: parseAgentsListRouteArgs,
      argv: ["node", "branch", "agents", "list", "extra"],
    },
    {
      name: "agents list flag terminator",
      parse: parseAgentsListRouteArgs,
      argv: ["node", "branch", "agents", "list", "--", "--json"],
    },
    {
      name: "config get empty excess operand",
      parse: parseConfigGetRouteArgs,
      argv: ["node", "branch", "config", "get", "gateway.port", ""],
    },
    {
      name: "config get unknown flag after an empty operand",
      parse: parseConfigGetRouteArgs,
      argv: ["node", "branch", "config", "get", "gateway.port", "", "--unknown"],
    },
    {
      name: "config get extra path after an empty operand",
      parse: parseConfigGetRouteArgs,
      argv: ["node", "branch", "config", "get", "gateway.port", "", "gateway.bind"],
    },
    {
      name: "config unset empty excess operand",
      parse: parseConfigUnsetRouteArgs,
      argv: ["node", "branch", "config", "unset", "gateway.port", "", "--dry-run"],
    },
    {
      name: "health empty excess operand",
      parse: parseHealthRouteArgs,
      argv: ["node", "branch", "health", ""],
    },
    {
      name: "agents list empty excess operand",
      parse: parseAgentsListRouteArgs,
      argv: ["node", "branch", "agents", "list", ""],
    },
  ])("defers unsupported routed argv: $name", ({ parse, argv }) => {
    expect(parse(argv)).toBeNull();
  });

  it("preserves equals forms and root options on routed argv", () => {
    expect(
      parseHealthRouteArgs([
        "node",
        "branch",
        "--profile",
        "work",
        "health",
        "--timeout=5000",
        "--json",
      ]),
    ).toEqual({ json: true, verbose: false, timeoutMs: 5000 });
    expect(
      parseSessionsRouteArgs(["node", "branch", "sessions", "--agent=default", "--limit=25"]),
    ).toMatchObject({ agent: "default", limit: "25" });
    expect(
      parseAgentsListRouteArgs([
        "node",
        "branch",
        "--log-level=debug",
        "agents",
        "list",
        "--json",
      ]),
    ).toEqual({ json: true, bindings: false, tree: false });
    expect(
      parseAgentsListRouteArgs(["node", "branch", "agents", "--json", "--bindings"]),
    ).toEqual({ json: true, bindings: true, tree: false });
  });

  it("parses gateway status route args and rejects probe-only ssh flags", () => {
    expect(
      parseGatewayStatusRouteArgs([
        "node",
        "branch",
        "gateway",
        "status",
        "--url",
        "ws://127.0.0.1:18789",
        "--token",
        "abc",
        "--password",
        "def",
        "--timeout",
        "5000",
        "--deep",
        "--require-rpc",
        "--json",
      ]),
    ).toEqual({
      rpc: {
        url: "ws://127.0.0.1:18789",
        token: "abc",
        password: "def",
        timeout: "5000",
      },
      probe: true,
      requireRpc: true,
      deep: true,
      json: true,
    });
    expect(
      parseGatewayStatusRouteArgs(["node", "branch", "gateway", "status", "--ssh", "host"]),
    ).toBeNull();
    expect(
      parseGatewayStatusRouteArgs(["node", "branch", "gateway", "status", "--ssh-auto"]),
    ).toBeNull();
  });

  it("parses JSON gateway health route args and defers unsupported shapes", () => {
    expect(
      parseGatewayHealthRouteArgs([
        "node",
        "branch",
        "gateway",
        "health",
        "--url",
        "ws://127.0.0.1:18789",
        "--token",
        "abc",
        "--password",
        "def",
        "--timeout",
        "5000",
        "--expect-final",
        "--json",
      ]),
    ).toEqual({
      rpc: {
        url: "ws://127.0.0.1:18789",
        token: "abc",
        password: "def",
        timeout: "5000",
        expectFinal: true,
        json: true,
      },
      localPortOverride: undefined,
    });
    expect(
      parseGatewayHealthRouteArgs([
        "node",
        "branch",
        "gateway",
        "--port",
        "19083",
        "health",
        "--json",
      ]),
    ).toEqual({
      rpc: {
        url: undefined,
        token: undefined,
        password: undefined,
        timeout: "10000",
        expectFinal: false,
        json: true,
      },
      localPortOverride: 19083,
    });
    expect(parseGatewayHealthRouteArgs(["node", "branch", "gateway", "health"])).toBeNull();
    expect(
      parseGatewayHealthRouteArgs([
        "node",
        "branch",
        "gateway",
        "health",
        "--url",
        "ws://127.0.0.1:18789",
        "--port",
        "19083",
        "--json",
      ]),
    ).toBeNull();
    expect(
      parseGatewayHealthRouteArgs([
        "node",
        "branch",
        "gateway",
        "health",
        "--timeout",
        "5s",
        "--json",
      ]),
    ).toBeNull();
  });

  it("parses sessions and agents list route args", () => {
    expect(
      parseSessionsRouteArgs([
        "node",
        "branch",
        "sessions",
        "--json",
        "--all-agents",
        "--agent",
        "default",
        "--store",
        "sqlite",
        "--active",
        "true",
        "--limit",
        "25",
      ]),
    ).toEqual({
      json: true,
      allAgents: true,
      agent: "default",
      store: "sqlite",
      active: "true",
      limit: "25",
    });
    expect(parseSessionsRouteArgs(["node", "branch", "sessions", "--agent"])).toBeNull();
    expect(parseSessionsRouteArgs(["node", "branch", "sessions", "--limit"])).toBeNull();
    expect(
      parseAgentsListRouteArgs([
        "node",
        "branch",
        "agents",
        "list",
        "--json",
        "--bindings",
        "--tree",
      ]),
    ).toEqual({
      json: true,
      bindings: true,
      tree: true,
    });
    expect(parseAgentsListRouteArgs(["node", "branch", "agents"])).toEqual({
      json: false,
      bindings: false,
      tree: false,
    });
  });

  it("parses config routes", () => {
    expect(
      parseConfigGetRouteArgs([
        "node",
        "branch",
        "--log-level",
        "debug",
        "config",
        "get",
        "update.channel",
        "--json",
      ]),
    ).toEqual({
      path: "update.channel",
      json: true,
    });
    expect(
      parseConfigUnsetRouteArgs([
        "node",
        "branch",
        "config",
        "unset",
        "--profile",
        "work",
        "update.channel",
      ]),
    ).toEqual({
      path: "update.channel",
      cliOptions: {
        dryRun: false,
        allowExec: false,
        json: false,
      },
    });
    expect(
      parseConfigUnsetRouteArgs([
        "node",
        "branch",
        "config",
        "unset",
        "--dry-run",
        "--json",
        "--allow-exec",
        "update.channel",
      ]),
    ).toEqual({
      path: "update.channel",
      cliOptions: {
        dryRun: true,
        allowExec: true,
        json: true,
      },
    });
    expect(parseConfigGetRouteArgs(["node", "branch", "config", "get", "--json"])).toBeNull();
  });

  it("parses models list and models status route args", () => {
    expect(
      parseModelsListRouteArgs([
        "node",
        "branch",
        "models",
        "list",
        "--provider",
        "openai",
        "--all",
        "--local",
        "--json",
        "--plain",
      ]),
    ).toEqual({
      provider: "openai",
      all: true,
      local: true,
      json: true,
      plain: true,
    });
    expect(
      parseModelsStatusRouteArgs([
        "node",
        "branch",
        "models",
        "status",
        "--probe-provider",
        "openai",
        "--probe-timeout",
        "5000",
        "--probe-concurrency",
        "2",
        "--probe-max-tokens",
        "64",
        "--probe-profile",
        "fast",
        "--probe-profile",
        "safe",
        "--agent",
        "default",
        "--json",
        "--plain",
        "--check",
        "--probe",
      ]),
    ).toEqual({
      probeProvider: "openai",
      probeTimeout: "5000",
      probeConcurrency: "2",
      probeMaxTokens: "64",
      probeProfile: ["fast", "safe"],
      agent: "default",
      json: true,
      plain: true,
      check: true,
      probe: true,
    });
    expect(
      parseModelsStatusRouteArgs(["node", "branch", "models", "status", "--probe-profile"]),
    ).toBeNull();
  });

  it.each([
    {
      name: "gateway status",
      parse: parseGatewayStatusRouteArgs,
      argv: ["node", "branch", "gateway", "status", "--wat"],
    },
    {
      name: "models list",
      parse: parseModelsListRouteArgs,
      argv: ["node", "branch", "models", "list", "--wat"],
    },
    {
      name: "models status",
      parse: parseModelsStatusRouteArgs,
      argv: ["node", "branch", "models", "status", "--wat"],
    },
    {
      name: "channels list",
      parse: parseChannelsListRouteArgs,
      argv: ["node", "branch", "channels", "list", "--wat"],
    },
    {
      name: "channels status",
      parse: parseChannelsStatusRouteArgs,
      argv: ["node", "branch", "channels", "status", "--wat"],
    },
  ])("defers unknown options for sibling routed parser: $name", ({ parse, argv }) => {
    expect(parse(argv)).toBeNull();
  });
});
