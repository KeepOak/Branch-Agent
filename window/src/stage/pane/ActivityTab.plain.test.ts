import { expect, it } from "vitest";
import type { Block } from "../../thread/model";
import { stepDetail } from "./ActivityTab";

// Owner, 2026-10-15: the Activity list showed "Used heartbeat respond / no_change" and raw tool output such as
// "Sent visible reply to the current source conversation via internal-ui". Normal views show the reason only when a step
// failed or was refused; a finished step's output shows at Technical.
const step = (status: string, detail?: string) => ({ kind: "step", key: "k", tool: "message", status, detail }) as unknown as Extract<Block, { kind: "step" }>;

it("hides a finished step's raw output below Technical", () => {
  expect(stepDetail(step("ok", "Sent visible reply to the current source conversation via internal-ui."), "regular")).toBeNull();
  expect(stepDetail(step("ok", "Sent visible reply to the current source conversation via internal-ui."), "advanced")).toBeNull();
  expect(stepDetail(step("ok", "Sent visible reply"), "technical")).toContain("Sent visible reply");
});

it("always explains a failed or refused step, and never prints JSON", () => {
  expect(stepDetail(step("failed", "The file was not found."), "regular")).toContain("not found");
  expect(stepDetail(step("denied", "You said no."), "regular")).toContain("You said no");
  expect(stepDetail(step("failed", '{"message":"Not Found","status":"404"}'), "technical")).toBeNull();
  expect(stepDetail(step("ok"), "technical")).toBeNull();
});
