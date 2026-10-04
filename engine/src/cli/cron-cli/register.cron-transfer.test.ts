// AUTOMATION-0048: ported from cline/cline apps/cli/src/commands/schedule.test.ts
// ("runScheduleCommand import" and "runScheduleCommand export").
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultRuntime } from "../../runtime.js";

const callGatewayFromCli = vi.fn();
vi.mock("../gateway-rpc.js", async () => {
  const actual = await vi.importActual<typeof import("../gateway-rpc.js")>("../gateway-rpc.js");
  return {
    ...actual,
    callGatewayFromCli: (...args: Parameters<typeof actual.callGatewayFromCli>) =>
      callGatewayFromCli(...args),
  };
});
const { registerCronCli } = await import("./register.js");

const exportedJob = {
  id: "job-1",
  name: "Morning brief",
  description: "Summarize the inbox",
  enabled: true,
  agentId: "main",
  createdAtMs: 1,
  updatedAtMs: 2,
  configRevision: "rev-1",
  schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Brief me" },
  delivery: { mode: "announce", channel: "telegram", to: "123" },
  state: { nextRunAtMs: 10, lastRunStatus: "ok" },
  nextRunAtMs: 10,
  lastRunStatus: "ok",
};
const portable = {
  name: "Morning brief",
  description: "Summarize the inbox",
  enabled: true,
  agentId: "main",
  schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
  sessionTarget: "isolated",
  wakeMode: "now",
  payload: { kind: "agentTurn", message: "Brief me" },
  delivery: { mode: "announce", channel: "telegram", to: "123" },
};

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "branch-cron-transfer-"));
  callGatewayFromCli.mockReset().mockImplementation(async (method: string, _opts, params) => {
    if (method === "cron.get") {
      return exportedJob;
    }
    if (method === "cron.add") {
      return { ...(params as object), id: "job-2" };
    }
    throw new Error(`unexpected cron method: ${method}`);
  });
  vi.spyOn(defaultRuntime, "log").mockImplementation(() => {});
  vi.spyOn(defaultRuntime, "writeJson").mockImplementation(() => {});
  vi.spyOn(defaultRuntime, "error").mockImplementation(() => {});
  vi.spyOn(defaultRuntime, "exit").mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

async function run(args: string[]) {
  const program = new Command().name("branch").exitOverride();
  registerCronCli(program);
  await program.parseAsync(["cron", ...args], { from: "user" });
}

describe("cron export", () => {
  it("writes JSON content to the --to file path", async () => {
    const target = join(dir, "nested", "brief.json");
    await run(["export", "job-1", "--to", target]);
    expect(callGatewayFromCli).toHaveBeenCalledWith("cron.get", expect.anything(), { id: "job-1" });
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(portable);
    expect(defaultRuntime.log).toHaveBeenCalledWith(`Exported automation job-1 to ${target}`);
  });

  it("writes YAML content when --to has a non-json extension", async () => {
    const target = join(dir, "brief.yaml");
    await run(["export", "job-1", "--to", target]);
    const yaml = await import("yaml");
    expect(yaml.parse(await readFile(target, "utf8"))).toEqual(portable);
  });
});

describe("cron import", () => {
  it("creates the automation from an exported file, dropping source-store state", async () => {
    const source = join(dir, "foreign.json");
    await writeFile(source, JSON.stringify(exportedJob), "utf8");
    await run(["import", source]);
    expect(callGatewayFromCli).toHaveBeenCalledWith("cron.add", expect.anything(), portable);
  });

  it("round-trips a YAML export into cron.add", async () => {
    const target = join(dir, "brief.yml");
    await run(["export", "job-1", "--to", target]);
    await run(["import", target]);
    expect(callGatewayFromCli).toHaveBeenLastCalledWith("cron.add", expect.anything(), portable);
  });

  it("fails without a name", async () => {
    const source = join(dir, "nameless.json");
    await writeFile(source, JSON.stringify({ schedule: portable.schedule }), "utf8");
    await expect(run(["import", source])).rejects.toThrow("exit 1");
    expect(callGatewayFromCli).not.toHaveBeenCalledWith(
      "cron.add",
      expect.anything(),
      expect.anything(),
    );
  });
});
