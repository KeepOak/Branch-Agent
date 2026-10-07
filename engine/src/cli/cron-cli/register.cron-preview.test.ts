import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { isCommandJsonOutputMode } from "../program/json-mode.js";
import { registerCronPreviewCommand } from "./register.cron-preview.js";

async function execute(args: string[]) {
  const output: string[] = [];
  const parent = new Command("cron").exitOverride().configureOutput({ writeErr: () => {} });
  const command = registerCronPreviewCommand(parent, { log: (value: unknown) => output.push(String(value)) },
    () => Date.parse("2026-10-04T00:00:00Z"));
  await parent.parseAsync(["preview", ...args], { from: "user" });
  return { output, command };
}

describe("cron preview CLI consumer", () => {
  it("uses source preview defaults and native dates through actual Commander", async () => {
    const { output, command } = await execute(["0 9 * * *", "--tz", "UTC", "--json"]);
    const result = JSON.parse(output[0]!);
    expect(result.occurrences).toHaveLength(5);
    expect(result.occurrences[0].runAt).toBe("2026-10-04T09:00:00.000Z");
    expect(result.occurrences[0].localTime).toBe("2026-10-04T09:00:00+00:00");
    expect(isCommandJsonOutputMode(command)).toBe(true);
  });

  it("accepts explicit reference offsets and returns readable advisory dates", async () => {
    const { output } = await execute(["0 9 * * *", "--tz", "America/New_York", "--count", "1",
      "--from", "2026-10-04T08:00:00-04:00"]);
    expect(output).toHaveLength(1);
    expect(output[0]).toContain("Advisory occurrences");
    expect(output[0]).toContain("2026-10-04T13:00:00.000Z\t2026-10-04T09:00:00-04:00");
  });

  it("rejects missing timezone, invalid counts and offsetless references", async () => {
    await expect(execute(["0 9 * * *"])).rejects.toThrow();
    for (const count of ["0", "11", "1.5", "5garbage", "1e1"]) {
      await expect(execute(["0 9 * * *", "--tz", "UTC", "--count", count])).rejects.toThrow(/count/);
    }
    await expect(execute(["0 9 * * *", "--tz", "UTC", "--from", "2026-10-04T00:00:00"])).rejects.toThrow(/explicit timezone/);
    await expect(execute(["0 9 * * *", "--tz", "UTC", "--from", "2026-02-30T00:00:00Z"])).rejects.toThrow(/ISO timestamp/);
  });
});
