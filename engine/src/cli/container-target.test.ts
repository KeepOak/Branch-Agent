// Container target tests cover CLI container target parsing and validation.
import type { spawnSync as nodeSpawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { maybeRunCliInContainer, parseCliContainerArgs } from "./container-target.js";

const childProcessMocks = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync: childProcessMocks.spawnSync }));

const stdinTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
const stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
afterEach(() => {
  vi.unstubAllEnvs();
  for (const [stream, descriptor] of [
    [process.stdin, stdinTty],
    [process.stdout, stdoutTty],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(stream, "isTTY", descriptor);
    } else {
      Reflect.deleteProperty(stream, "isTTY");
    }
  }
});

function runInContainer(
  argv: string[],
  setup: {
    env: NodeJS.ProcessEnv;
    spawnSync?: typeof nodeSpawnSync;
    stdinIsTTY?: boolean;
    stdoutIsTTY?: boolean;
  },
) {
  for (const name of [
    "BRANCH_CONTAINER",
    "BRANCH_CLI_CONTAINER_BYPASS",
    "BRANCH_PROXY_URL",
    "BRANCH_CONTAINER_ALLOW_LOOPBACK_PROXY_URL",
    "BRANCH_PROFILE",
    "BRANCH_GATEWAY_PORT",
    "BRANCH_GATEWAY_URL",
    "BRANCH_GATEWAY_TOKEN",
    "BRANCH_GATEWAY_PASSWORD",
  ]) {
    vi.stubEnv(name, undefined);
  }
  for (const [name, value] of Object.entries(setup.env)) {
    vi.stubEnv(name, value);
  }
  Object.defineProperty(process.stdin, "isTTY", {
    configurable: true,
    value: setup.stdinIsTTY ?? false,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: setup.stdoutIsTTY ?? false,
  });
  childProcessMocks.spawnSync.mockReset();
  if (setup.spawnSync) {
    childProcessMocks.spawnSync.mockImplementation(setup.spawnSync);
  }
  return maybeRunCliInContainer(argv);
}

function requireSpawnCall(
  spawnSync: ReturnType<typeof vi.fn>,
  index: number,
): [string, string[], unknown?] {
  const call = spawnSync.mock.calls[index];
  if (!call) {
    throw new Error(`Expected spawnSync call ${index}`);
  }
  return call as [string, string[], unknown?];
}

type SpawnResult = {
  status: number | null;
  stdout?: string;
  signal?: NodeJS.Signals;
  error?: Error;
};
type SpawnMock = ReturnType<typeof vi.fn> & typeof nodeSpawnSync;

const runningContainer = { status: 0, stdout: "true\n" };
const missingContainer = { status: 1, stdout: "" };
const successfulExec = { status: 0, stdout: "" };
const probeOptions = { encoding: "utf8", killSignal: "SIGKILL", timeout: 10_000 };

function mockSpawn(...results: SpawnResult[]): SpawnMock {
  const spawnSync = vi.fn();
  for (const result of results) {
    spawnSync.mockReturnValueOnce(result);
  }
  return spawnSync as SpawnMock;
}

function expectRuntimeProbe(
  spawnSync: SpawnMock,
  index: number,
  runtime: "podman" | "docker",
  container = "demo",
): void {
  expect(spawnSync).toHaveBeenNthCalledWith(
    index,
    runtime,
    ["inspect", "--format", "{{.State.Running}}", container],
    probeOptions,
  );
}

function expectContainerExec(
  spawnSync: SpawnMock,
  params: {
    runtime?: "podman" | "docker";
    argv?: string[];
    container?: string;
    index?: number;
    tty?: boolean;
    proxyUrl?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): void {
  const runtime = params.runtime ?? "podman";
  const envFlag = runtime === "docker" ? "-e" : "--env";
  expect(spawnSync).toHaveBeenNthCalledWith(
    params.index ?? 3,
    runtime,
    [
      "exec",
      "-i",
      ...(params.tty ? ["-t"] : []),
      envFlag,
      `BRANCH_CONTAINER_HINT=${params.container ?? "demo"}`,
      envFlag,
      "BRANCH_CLI_CONTAINER_BYPASS=1",
      ...(params.proxyUrl ? [envFlag, `BRANCH_PROXY_URL=${params.proxyUrl}`] : []),
      params.container ?? "demo",
      "branch",
      ...(params.argv ?? ["status"]),
    ],
    {
      stdio: "inherit",
      env: expect.objectContaining({ ...params.env, BRANCH_CONTAINER: "" }),
    },
  );
}

describe("parseCliContainerArgs", () => {
  it("accepts the equals form", () => {
    expect(parseCliContainerArgs(["node", "branch", "--container=demo", "health"])).toEqual({
      ok: true,
      container: "demo",
      argv: ["node", "branch", "health"],
    });
  });

  it("rejects a missing container value", () => {
    expect(parseCliContainerArgs(["node", "branch", "--container"])).toEqual({
      ok: false,
      error: "--container requires a value",
    });
  });

  it("does not consume an adjacent flag as the container value", () => {
    expect(
      parseCliContainerArgs(["node", "branch", "--container", "--no-color", "status"]),
    ).toEqual({
      ok: false,
      error: "--container requires a value",
    });
  });

  it("extracts --container after the command like other root options", () => {
    expect(
      parseCliContainerArgs(["node", "branch", "status", "--container", "demo", "--deep"]),
    ).toEqual({
      ok: true,
      container: "demo",
      argv: ["node", "branch", "status", "--deep"],
    });
  });

  it("stops parsing --container after the -- terminator", () => {
    expect(
      parseCliContainerArgs([
        "node",
        "branch",
        "nodes",
        "run",
        "--",
        "docker",
        "run",
        "--container",
        "demo",
        "alpine",
      ]),
    ).toEqual({
      ok: true,
      container: null,
      argv: [
        "node",
        "branch",
        "nodes",
        "run",
        "--",
        "docker",
        "run",
        "--container",
        "demo",
        "alpine",
      ],
    });
  });
});

describe("maybeRunCliInContainer", () => {
  it("passes through when no container target is provided", () => {
    expect(runInContainer(["node", "branch", "status"], { env: {} })).toEqual({
      handled: false,
      argv: ["node", "branch", "status"],
    });
  });

  it.each([
    { result: { status: 7 }, exitCode: 7, outcome: "status 7" },
    { result: { status: null, signal: "SIGINT" as const }, exitCode: 130, outcome: "SIGINT" },
    { result: { status: null, signal: "SIGTERM" as const }, exitCode: 143, outcome: "SIGTERM" },
  ])("preserves exit code $exitCode when the container child returns $outcome", (testCase) => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, {
      ...testCase.result,
    });

    expect(
      runInContainer(["node", "branch", "status"], {
        env: { BRANCH_CONTAINER: "demo" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: testCase.exitCode,
    });
  });

  it.each(["ENOENT"])("throws the original %s launch error from the container exec", (code) => {
    const launchError = Object.assign(new Error(`spawnSync podman ${code}`), { code });
    const spawnSync = mockSpawn(runningContainer, missingContainer, {
      status: null,
      error: launchError,
    });

    let thrown: unknown;
    try {
      runInContainer(["node", "branch", "status"], {
        env: { BRANCH_CONTAINER: "demo" } as NodeJS.ProcessEnv,
        spawnSync,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(launchError);
  });

  it("clears inherited host routing and gateway env before execing into the child CLI", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    runInContainer(["node", "branch", "status"], {
      env: {
        BRANCH_CONTAINER: "demo",
        BRANCH_PROFILE: "work",
        BRANCH_GATEWAY_PORT: "19001",
        BRANCH_GATEWAY_URL: "ws://127.0.0.1:18789",
        BRANCH_GATEWAY_TOKEN: "token",
        BRANCH_GATEWAY_PASSWORD: "password",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    expectContainerExec(spawnSync);
    const childOptions = requireSpawnCall(spawnSync, 2)[2] as { env: NodeJS.ProcessEnv };
    for (const name of [
      "BRANCH_PROFILE",
      "BRANCH_GATEWAY_PORT",
      "BRANCH_GATEWAY_URL",
      "BRANCH_GATEWAY_TOKEN",
      "BRANCH_GATEWAY_PASSWORD",
    ]) {
      expect(childOptions.env).not.toHaveProperty(name);
    }
  });

  it("passes the proxy URL env fallback into the child container CLI", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    runInContainer(["node", "branch", "status"], {
      env: {
        BRANCH_CONTAINER: "demo",
        BRANCH_PROXY_URL: " http://proxy.internal:3128 ",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    expectContainerExec(spawnSync, {
      proxyUrl: "http://proxy.internal:3128",
      env: { BRANCH_PROXY_URL: " http://proxy.internal:3128 " },
    });
  });

  it.each([
    "http://127.0.0.1:3128",
    "http://127.1:3128",
    "http://127.0.0.01:3128",
    "http://localhost.:3128",
    "http://[::1]:3128",
    "http://[::ffff:127.0.0.1]:3128",
  ])("fails before forwarding loopback proxy URL %s into a child container CLI", (proxyUrl) => {
    const spawnSync = mockSpawn(runningContainer, missingContainer);

    expect(() =>
      runInContainer(["node", "branch", "status"], {
        env: {
          BRANCH_CONTAINER: "demo",
          BRANCH_PROXY_URL: ` ${proxyUrl} `,
        } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow("127.0.0.1 inside a container points at the container");

    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("redacts proxy URL credentials and URL suffixes before rejecting loopback container proxy forwarding", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer);

    let message = "";
    try {
      runInContainer(["node", "branch", "status"], {
        env: {
          BRANCH_CONTAINER: "demo",
          BRANCH_PROXY_URL:
            "http://proxy-user:proxy-secret@127.1:3128?token=proxy-query-secret#proxy-fragment-secret",
        } as NodeJS.ProcessEnv,
        spawnSync,
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toContain("BRANCH_PROXY_URL=http://redacted:redacted@127.0.0.1:3128/");
    expect(message).not.toContain("proxy-user");
    expect(message).not.toContain("proxy-secret");
    expect(message).not.toContain("proxy-query-secret");
    expect(message).not.toContain("proxy-fragment-secret");
    expect(message).not.toContain("?token=");
    expect(message).not.toContain("#");
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it("allows explicitly overridden loopback proxy URL forwarding into a child container CLI", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    runInContainer(["node", "branch", "status"], {
      env: {
        BRANCH_CONTAINER: "demo",
        BRANCH_PROXY_URL: " http://127.0.0.1:3128 ",
        BRANCH_CONTAINER_ALLOW_LOOPBACK_PROXY_URL: "1",
      } as NodeJS.ProcessEnv,
      spawnSync,
    });

    const podmanCall = requireSpawnCall(spawnSync, 2);
    expect(podmanCall[0]).toBe("podman");
    expect(podmanCall[1]).toContain("BRANCH_PROXY_URL=http://127.0.0.1:3128");
    if (podmanCall[2] === undefined) {
      throw new Error("Expected podman spawn options");
    }
  });

  it("executes through podman when the named container is running", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    expect(
      runInContainer(["node", "branch", "--container", "demo", "status"], {
        env: {},
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expectRuntimeProbe(spawnSync, 1, "podman");
    expectContainerExec(spawnSync);
  });

  it("checks docker after podman and before failing", () => {
    const spawnSync = mockSpawn(missingContainer, runningContainer, successfulExec, successfulExec);

    expect(
      runInContainer(["node", "branch", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expectRuntimeProbe(spawnSync, 1, "podman");
    expectRuntimeProbe(spawnSync, 2, "docker");
    expectContainerExec(spawnSync, { runtime: "docker", env: { USER: "somalley" } });
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it("does not try any sudo podman fallback for regular users", () => {
    const spawnSync = mockSpawn(missingContainer, missingContainer);

    expect(() =>
      runInContainer(["node", "branch", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow('No running container matched "demo" under podman or docker.');

    expect(spawnSync).toHaveBeenCalledTimes(2);
    expectRuntimeProbe(spawnSync, 1, "podman");
    expectRuntimeProbe(spawnSync, 2, "docker");
  });

  it("rejects ambiguous matches across runtimes", () => {
    const spawnSync = mockSpawn(runningContainer, runningContainer, missingContainer);

    expect(() =>
      runInContainer(["node", "branch", "--container", "demo", "status"], {
        env: { USER: "somalley" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toThrow(
      'Container "demo" is running under multiple runtimes (podman, docker); use a unique container name.',
    );
  });

  it("allocates a tty for interactive terminal sessions", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    runInContainer(["node", "branch", "--container", "demo", "setup"], {
      env: {},
      spawnSync,
      stdinIsTTY: true,
      stdoutIsTTY: true,
    });

    expectContainerExec(spawnSync, { argv: ["setup"], tty: true });
  });

  it("prefers --container over BRANCH_CONTAINER", () => {
    const spawnSync = mockSpawn(runningContainer, missingContainer, successfulExec);

    expect(
      runInContainer(["node", "branch", "--container", "flag-demo", "health"], {
        env: { BRANCH_CONTAINER: "env-demo" } as NodeJS.ProcessEnv,
        spawnSync,
      }),
    ).toEqual({
      handled: true,
      exitCode: 0,
    });

    expectRuntimeProbe(spawnSync, 1, "podman", "flag-demo");
  });

  it("skips recursion when the bypass env is set", () => {
    expect(
      runInContainer(["node", "branch", "--container", "demo", "status"], {
        env: { BRANCH_CLI_CONTAINER_BYPASS: "1" } as NodeJS.ProcessEnv,
      }),
    ).toEqual({
      handled: false,
      argv: ["node", "branch", "--container", "demo", "status"],
    });
  });

  it("blocks update after interleaved root flags", () => {
    const spawnSync = mockSpawn(runningContainer);

    expect(() =>
      runInContainer(["node", "branch", "--container", "demo", "--no-color", "update"], {
        env: {},
        spawnSync,
      }),
    ).toThrow(
      "branch update is not supported with --container; rebuild or restart the container image instead.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("blocks the --update shorthand from running inside the container", () => {
    const spawnSync = mockSpawn(runningContainer);

    expect(() =>
      runInContainer(["node", "branch", "--container", "demo", "--update"], {
        env: {},
        spawnSync,
      }),
    ).toThrow(
      "branch update is not supported with --container; rebuild or restart the container image instead.",
    );
    expect(spawnSync).not.toHaveBeenCalled();
  });
});
