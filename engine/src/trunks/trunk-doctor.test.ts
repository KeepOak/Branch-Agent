import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateCronAddParams } from "../../packages/gateway-protocol/src/index.js";
import { resolveEffectiveToolFsWorkspaceOnly } from "../agents/tool-fs-policy.js";
import { resolveDisabledToolsetTools } from "../agents/tool-toolsets.js";
import { resolveAgentFullAccess } from "../agents/tools/agent-full-access.js";
import { createBranchDelegateToolsForRun } from "../agents/tools/branch-delegate-tool.js";
import type { BranchConfig } from "../config/types.branch.js";
import { normalizeSilentReplyText } from "../cron/isolated-agent/delivery-dispatch-policy.js";
import { normalizeCronJobCreate } from "../cron/normalize.js";
import { computeNextRunAtMs } from "../cron/schedule.js";
import type { CronSchedule } from "../cron/types.js";
import { parseTrunkTemplate, type TrunkTemplate } from "./trunk-template.js";

const TEMPLATE_FILE = path.resolve(
  import.meta.dirname,
  "../../skills/trunk-templates/trunk-doctor.branch.trunk-template.json",
);

function doctor(): { template: TrunkTemplate; warnings: string[] } {
  const parsed = parseTrunkTemplate(JSON.parse(readFileSync(TEMPLATE_FILE, "utf8")) as unknown);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed;
}

/** The text of one "## Heading" section of the persona, up to the next level-2 heading. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = markdown.slice(start + heading.length + 4);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

type ScheduleBlock = {
  name: string;
  schedule: CronSchedule;
  sessionTarget: string;
  payload: { kind: string; message: string };
};

function schedules(): ScheduleBlock[] {
  const block = /```json\n([\s\S]*?)\n```/.exec(
    section(doctor().template.persona.agentsMd, "Schedules"),
  );
  expect(block).not.toBeNull();
  return JSON.parse(block?.[1] ?? "[]") as ScheduleBlock[];
}

/** Tools that send, steer sessions, spend, sign, install or change configuration. */
const OUTBOUND_TOOLS = [
  "message",
  "conversations_send",
  "conversations_turn",
  "room_post",
  "trunk_message",
  "sessions",
  "sessions_send",
  "sessions_spawn",
  "subagents",
  "web_search",
  "web_fetch",
  "x_search",
  "browser",
  "exec",
  "process",
  "terminal",
  "computer",
  "nodes",
  "github_publish",
  "secrets",
  "gateway",
  "plugins",
  "image_generate",
  "tts",
];

const GLOBAL_FULL_ACCESS = { tools: { exec: { host: "gateway", security: "full", ask: "off" } } };

function configWith(entries: Record<string, unknown>): BranchConfig {
  return { ...GLOBAL_FULL_ACCESS, agents: { entries } } as unknown as BranchConfig;
}

function doctorEntry(template: TrunkTemplate) {
  return {
    name: template.name,
    toolsets: template.toolsets,
    tools: { deny: template.denyTools, fs: { workspaceOnly: template.askFirst === true } },
  };
}

describe("Trunk Doctor template", () => {
  it("parses cleanly as a day-one template with a face from the look set", () => {
    const { template, warnings } = doctor();
    expect(warnings).toEqual([]);
    expect(template.name).toBe("Trunk Doctor");
    expect(template.dayOne).toBe(true);
    expect(template.look).toBe("branch:tock");
    expect(template.askFirst).toBe(true);
  });

  it("first run asks two or three questions, one per message, then sets up and starts working", () => {
    const firstRun = section(doctor().template.persona.agentsMd, "First run");
    const questions = firstRun.match(/^\d+\. "[^"]+/gm) ?? [];
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions.length).toBeLessThanOrEqual(3);
    expect(firstRun).toContain("one per message");
    expect(firstRun).toContain("checkup-notes.md");
    expect(firstRun).toContain("automations tool");
    expect(firstRun).toMatch(/start the interview|run a first friction scan/);
  });

  it("states the anti-jobs from the card", () => {
    const never = section(doctor().template.persona.agentsMd, "Never");
    expect(never).toContain(
      "Never create, change, rename, pause or delete a Trunk without the owner's clear yes",
    );
    expect(never).toContain("Never publish a seed");
    expect(never).toContain("Never send, post, buy, sign or install anything");
  });
});

describe("Trunk Doctor scheduled runs", () => {
  const timeZone = "America/New_York";
  // Friday 2026-10-16 18:00 in New York (22:00 UTC).
  const fridayEvening = Date.UTC(2026, 9, 16, 22, 0);

  it("has a weekday friction scan and a Monday waste audit that the scheduler accepts", () => {
    const [scan, audit] = schedules();
    expect(scan?.name).toBe("Trunk Doctor: friction scan");
    expect(audit?.name).toBe("Trunk Doctor: waste audit");
    for (const job of [scan, audit]) {
      const created = normalizeCronJobCreate(
        { ...job, agentId: "trunk-doctor", schedule: { ...job?.schedule, tz: timeZone } },
        { sessionContext: { sessionKey: "agent:trunk-doctor:main" } },
      );
      expect(created).not.toBeNull();
      expect(validateCronAddParams(created)).toBe(true);
      expect(created?.payload).toMatchObject({ kind: "agentTurn" });
      expect(created?.delivery).toMatchObject({ mode: "announce" });
    }
  });

  it("runs the next friction scan on Monday evening and the waste audit on Monday morning", () => {
    const [scan, audit] = schedules();
    const nextRun = (job: ScheduleBlock | undefined) =>
      computeNextRunAtMs(
        { ...job?.schedule, tz: timeZone, staggerMs: 0 } as CronSchedule,
        fridayEvening,
      );
    const nextScan = nextRun(scan);
    const nextAudit = nextRun(audit);
    // Monday 2026-10-19: 17:30 and 09:00 in New York (EDT, UTC-4).
    expect(nextScan).toBe(Date.UTC(2026, 9, 19, 21, 30));
    expect(nextAudit).toBe(Date.UTC(2026, 9, 19, 13, 0));
  });

  it("stays silent when a run has nothing to report, and delivers a real finding", () => {
    for (const job of schedules()) {
      expect(job.payload.message).toContain("reply with exactly NO_REPLY");
    }
    expect(normalizeSilentReplyText("NO_REPLY").text).toBeUndefined();
    const finding =
      "1. Scout retried the same search 6 times on Oct 14. Fix: switch off its web toolset.";
    expect(normalizeSilentReplyText(finding).text).toBe(finding);
  });
});

describe("Trunk Doctor holds every outbound action for the owner", () => {
  it("gets no tool that sends, steers sessions, spends, signs or installs", () => {
    const { template } = doctor();
    const removed = new Set([
      ...resolveDisabledToolsetTools(template.toolsets),
      ...(template.denyTools ?? []),
    ]);
    expect(OUTBOUND_TOOLS.filter((tool) => !removed.has(tool))).toEqual([]);
    expect(removed.has("branch")).toBe(false);
    expect(removed.has("sessions_history")).toBe(false);
  });

  it("never gets Full access, even when every other Trunk has it", () => {
    const { template } = doctor();
    const config = configWith({ "trunk-doctor": doctorEntry(template), other: { name: "Other" } });
    const accessFor = (agentId: string) =>
      resolveAgentFullAccess({
        config,
        agentId,
        fsPolicy: { workspaceOnly: resolveEffectiveToolFsWorkspaceOnly({ cfg: config, agentId }) },
      });
    expect(accessFor("other")).toBe(true);
    expect(accessFor("trunk-doctor")).toBe(false);
  });

  it("asks Branch to make or change a Trunk only through a call that waits for the owner's approval", () => {
    const { template } = doctor();
    const config = configWith({ "trunk-doctor": doctorEntry(template) });
    const [tool] = createBranchDelegateToolsForRun({
      config,
      sessionAgentId: "trunk-doctor",
      agentSessionKey: "agent:trunk-doctor:main",
      fsPolicy: {
        workspaceOnly: resolveEffectiveToolFsWorkspaceOnly({
          cfg: config,
          agentId: "trunk-doctor",
        }),
      },
    });
    expect(tool?.name).toBe("branch");
    expect(tool?.description).toContain("Changes wait for the user to approve");
    expect(tool?.description).not.toContain("without asking for approval");
  });
});
