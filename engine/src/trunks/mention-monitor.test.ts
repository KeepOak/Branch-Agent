import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCronStoreHarness,
  createNoopLogger,
  withCronServiceForTest,
} from "../cron/service.test-harness.js";
import type { CronJobCreate } from "../cron/types.js";
import { createTestGatewayScheduler } from "../test-utils/gateway-scheduler-clock.js";
import fixture from "./fixtures/mention-monitor.json";
import { parseTrunkTemplate } from "./trunk-template.js";

const exec = promisify(execFile);
const helper = path.resolve("skills/mention-monitor/scripts/monitor.mjs");
const dirs: string[] = [];
const { makeStorePath } = createCronStoreHarness({ prefix: "mention-monitor-cron-" });
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});
async function workspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mention-monitor-"));
  dirs.push(dir);
  return dir;
}
async function run(command: string, input: unknown, dir: string) {
  const file = path.join(dir, "input.json");
  await fs.writeFile(file, JSON.stringify(input));
  const { stdout } = await exec(process.execPath, [helper, command, file, dir], {
    windowsHide: true,
  });
  return JSON.parse(stdout) as {
    job: CronJobCreate;
    watch: typeof fixture.watch;
    digest: string;
    hits: Array<{ url: string; storyKey: string }>;
    ledgerFile: string;
  };
}

describe("Mention monitor bundled workflow", () => {
  it("loads the installable template and its bundled skill without precreated automations", async () => {
    const parsed = parseTrunkTemplate(
      JSON.parse(
        await fs.readFile(
          "skills/trunk-templates/mention-monitor.branch.trunk-template.json",
          "utf8",
        ),
      ),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.template.skills).toEqual(["seedbank:@branch-agent/mention-monitor"]);
    expect(parsed.template.automations).toBeUndefined();
    const skill = await fs.readFile("skills/mention-monitor/SKILL.md", "utf8");
    expect(skill).toContain("enabled:false");
    expect(skill).toContain("Only a direct, explicit owner yes");
    expect(skill).toContain("X connector");
    expect(skill).toContain("LinkedIn only when explicitly requested");
  });

  it("creates a disabled local weekday routine and runs an enabled fixture through the real scheduler", async () => {
    const dir = await workspace();
    const prepared = await run("prepare", fixture.watch, dir);
    expect(prepared.job).toMatchObject({
      name: "Daily mention monitor",
      enabled: false,
      sessionTarget: "current",
      delivery: { mode: "announce" },
      schedule: { expr: "30 8 * * 1-5", tz: "America/New_York", staggerMs: 0 },
    });
    expect(prepared.watch).toMatchObject({
      sources: ["reddit", "hacker-news", "news", "x"],
      time: "08:30",
    });
    const runner = vi.fn(async () => {
      const result = await run("sweep", fixture, dir);
      return { status: "ok" as const, summary: result.digest, delivered: true };
    });
    await withCronServiceForTest(
      {
        makeStorePath,
        scheduler: createTestGatewayScheduler(),
        logger: createNoopLogger(),
        cronEnabled: false,
        runIsolatedAgentJob: runner,
      },
      async ({ cron }) => {
        const job = await cron.add({ ...prepared.job, sessionKey: "agent:main:mention-fixture" });
        expect(cron.getJob(job.id)?.enabled).toBe(false);
        expect(cron.getJob(job.id)?.state.nextRunAtMs).toBeUndefined();
        expect(runner).not.toHaveBeenCalled();
        // Simulate the owner's explicit enable approval, then replay recorded evidence.
        await cron.update(job.id, { enabled: true });
        expect(await cron.run(job.id, "force")).toEqual({ ok: true, ran: true });
        expect(runner).toHaveBeenCalledTimes(1);
        const result = await runner.mock.results[0].value;
        expect(result.summary).toContain(`<${fixture.candidates[0].url}>`);
        expect(await fs.readFile(path.join(dir, "mentions-2007-04-06.md"), "utf8")).toContain(
          result.summary,
        );
      },
    );
  });

  it("rejects incomplete interview data and validates local time and explicit source selection", async () => {
    const dir = await workspace();
    for (const input of [
      { timezone: "UTC" },
      { names: ["[NAME]"], timezone: "UTC" },
      { ...fixture.watch, timezone: "" },
      { ...fixture.watch, time: "25:30" },
      { ...fixture.watch, urls: ["not-a-url"] },
    ]) {
      await expect(run("prepare", input, dir)).rejects.toThrow();
    }
    const custom = await run(
      "prepare",
      { ...fixture.watch, time: "09:15", sources: ["news", "youtube", "linkedin"] },
      dir,
    );
    expect(custom.job.schedule).toMatchObject({ expr: "15 9 * * 1-5" });
    expect(custom.watch).toMatchObject({ sources: ["news", "youtube", "linkedin"] });
  });

  it("filters own posts/URLs, spam, bots, unverified links, old hits, duplicates, and opt-in sources", async () => {
    const dir = await workspace();
    const hit = fixture.candidates[0];
    const candidates = [
      hit,
      { ...hit, url: `${hit.url}&utm_source=duplicate` },
      {
        ...hit,
        url: "https://news.ycombinator.com/item?id=8863",
        authorUrl: fixture.watch.ownerUrls[0],
      },
      { ...hit, url: "https://www.getdropbox.com/tour" },
      { ...hit, url: "https://getdropbox.com/tour" },
      { ...hit, thirdParty: false },
      { ...hit, spam: true },
      { ...hit, bot: true },
      { ...hit, verified: false },
      { ...hit, url: "javascript:alert(1)" },
      { ...hit, url: "https://unobserved.invalid/", evidence: "" },
      { ...hit, publishedAt: "2006-01-01" },
      { ...hit, source: "youtube" },
      { ...hit, source: "instagram" },
      { ...hit, source: "tiktok" },
      { ...hit, source: "linkedin" },
      { ...hit, url: "https://news.ycombinator.com/item?id=8863", storyKey: hit.storyKey },
      { ...hit, summary: "extra https://unobserved.invalid/" },
      { ...hit, notable: false },
      { ...hit, evidence: "unrelated discussion" },
      { ...hit, spam: undefined },
    ];
    const result = await run("sweep", { ...fixture, candidates }, dir);
    expect(result.hits.map((entry) => entry.url)).toEqual([hit.url]);
    expect(result.digest.match(/https?:\/\/[^>]+/g)).toEqual([hit.url]);
    const ledger = await fs.readFile(path.join(dir, result.ledgerFile), "utf8");
    expect(ledger).toContain('"reason":"duplicate"');
    expect(ledger).toContain('"reason":"owner or unconfirmed third party"');
    expect(ledger).toContain('"reason":"source disabled"');
  });

  it("logs quiet/failed sweeps on the local date and deduplicates previous ledgers", async () => {
    const dir = await workspace();
    const input = {
      ...fixture,
      startedAt: "2007-04-06T01:00:00Z",
      coverage: { reddit: "checked", "hacker-news": "checked", news: "checked", x: "checked" },
    };
    const first = await run("sweep", input, dir);
    expect(first.ledgerFile).toBe("mentions-2007-04-05.md");
    const quiet = await run("sweep", { ...input, seenUrls: first.hits.map((hit) => hit.url) }, dir);
    expect(quiet.digest).toBe("");
    const failed = await run("sweep", { ...input, candidates: [], coverage: { x: "failed" } }, dir);
    expect(failed.digest.split("\n")).toHaveLength(1);
    expect(failed.digest).toContain("incomplete");
    expect(
      (await fs.readFile(path.join(dir, first.ledgerFile), "utf8")).match(/## Sweep/g),
    ).toHaveLength(3);
    await expect(run("sweep", { ...input, since: "invalid" }, dir)).rejects.toThrow();
  });
});
