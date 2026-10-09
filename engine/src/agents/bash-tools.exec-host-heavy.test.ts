import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as availableMemory from "../../scripts/lib/available-memory.mjs";
import { createFixtureLifetime } from "../../test/helpers/fixture-lifetime.js";
import { createDeferred } from "../../test/helpers/promise.js";
import type { RunExit, SpawnInput } from "../process/supervisor/types.js";
import { resetProcessRegistryForTests } from "./bash-process-registry.test-support.js";
import { runExecProcess } from "./bash-tools.exec-runtime.js";
import { createRunExit, runtimeManagedRun } from "./bash-tools.exec-runtime.test-support.js";

const supervisorMock = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("../process/supervisor/index.js", () => ({ getProcessSupervisor: () => supervisorMock }));

afterEach(() => {
  vi.restoreAllMocks();
  supervisorMock.spawn.mockReset();
  resetProcessRegistryForTests();
});

function runTestExecProcess(params: Partial<Parameters<typeof runExecProcess>[0]>) {
  return runExecProcess({
    command: "test-command",
    workdir: ".",
    env: {},
    usePty: false,
    warnings: [],
    maxOutput: 1000,
    pendingMaxOutput: 1000,
    notifyOnExit: false,
    timeoutSec: null,
    ...params,
  });
}

it("host-heavy admission publishes memory waiting, leaves light exec free, and resumes by itself", async () => {
  const fixture = createFixtureLifetime();
  const root = fixture.createTempDir("branch-host-heavy-exec-");
  const env = {
    BRANCH_HEAVY_STEP_DIRECTORY: path.join(root, "admission"),
    BRANCH_HOST_HEAVY_STEP_OWNER: "",
    BRANCH_HEAVY_STEP_BUILD_MEMORY_MB: "8",
  };
  const memory = vi.spyOn(availableMemory, "availableMemoryBytes").mockReturnValue(1024);
  const update = vi.fn();
  const controller = new AbortController();
  const completion = createDeferred<RunExit>();
  supervisorMock.spawn.mockImplementation(async (input: SpawnInput) => ({
    ...runtimeManagedRun(input),
    wait: () => completion.promise,
  }));
  const heavy = runTestExecProcess({
    command: "pnpm build",
    workdir: root,
    env,
    onUpdate: update,
    startupSignal: controller.signal,
  });
  let light: Awaited<ReturnType<typeof runExecProcess>> | undefined;
  try {
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining("Waiting for memory: 0 builds ahead"),
            }),
          ]),
        }),
      ),
    );
    expect(supervisorMock.spawn).not.toHaveBeenCalled();
    light = await runTestExecProcess({ command: "git status", workdir: root, env });
    expect(supervisorMock.spawn).toHaveBeenCalledOnce();
    memory.mockReturnValue(16 * 1024 ** 2);
    const admitted = await heavy;
    expect(supervisorMock.spawn).toHaveBeenCalledTimes(2);
    completion.resolve(createRunExit());
    await Promise.all([light.promise, admitted.promise]);
  } finally {
    controller.abort();
    completion.resolve(createRunExit());
    await heavy.then(
      (handle) => handle.promise,
      () => {},
    );
    await light?.promise;
    await fixture.cleanup();
  }
});
