import { asNullableRecord } from "@branch/normalization-core/record-coerce";
import type { BranchConfig } from "../../config/types.branch.js";
import type { SkillsWorkshopAutonomousMode } from "../../config/types.skills.js";

/** Runtime configuration for the skill workshop proposal flow. */
type SkillWorkshopConfig = {
  autonomous: {
    mode: SkillsWorkshopAutonomousMode;
  };
  approvalPolicy: "pending" | "auto";
  maxPending: number;
  maxSkillBytes: number;
};

function readInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), min), max)
    : fallback;
}

export function resolveSkillWorkshopConfig(config?: BranchConfig): SkillWorkshopConfig {
  const raw = asNullableRecord(config?.skills?.workshop) ?? {};
  const autonomous = asNullableRecord(raw.autonomous) ?? {};
  return {
    autonomous: {
      mode: autonomous.mode === "off" || autonomous.mode === "propose" ? autonomous.mode : "auto",
    },
    approvalPolicy: raw.approvalPolicy === "pending" ? "pending" : "auto",
    maxPending: readInteger(raw.maxPending, 50, 1, 200),
    maxSkillBytes: readInteger(raw.maxSkillBytes, 40_000, 1024, 200_000),
  };
}
