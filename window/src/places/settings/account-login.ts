// The engine wizard protocol for sign-ins (models.authLogin, branch.setup.*): steps, answers and safe links. Adapted from engine/ui/src/pages/model-setup/wizard-runner.ts
// (requestNext: sign-in notes are acknowledged and their link opened; gateway-owned progress is polled).
import type { WindowEngine } from "../../connect/engine";
import { record } from "./adapter";

export type WizardStep = {
  id: string;
  type: "note" | "select" | "text" | "confirm" | "multiselect" | "progress" | "action";
  title?: string;
  message?: string;
  options?: { value: unknown; label: string; hint?: string }[];
  initialValue?: unknown;
  placeholder?: string;
  sensitive?: boolean;
  executor?: "gateway" | "client";
  externalUrl?: string;
  deviceCode?: { code: string; expiresInMinutes?: number; message?: string };
};
export type WizardResult = { done: boolean; step?: WizardStep; status?: "running" | "done" | "cancelled" | "error"; error?: string };
export type WizardAnswer = { stepId: string; value?: unknown };
/** One provider sign-in through models.authLogin (the setup flow's "Add another account"). */
export type LoginStart = { agentId: string; provider: string; choiceId: string };

/** Only web links open from a sign-in step. */
export function safeSignInUrl(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Asks for the next step until one needs the person. Sign-in notes (a link, a device code) are shown while the
 *  engine waits for the browser, and gateway-owned progress is polled, as upstream requestNext does. */
export async function advance(
  request: WindowEngine["request"],
  sessionId: string,
  answer: WizardAnswer | undefined,
  show: (step: WizardStep) => void,
  notes: string[],
): Promise<WizardResult> {
  let next = answer;
  for (;;) {
    const result = record(await request("wizard.next", { sessionId, ...(next ? { answer: next } : {}) })) as WizardResult;
    const step = result.step;
    if (result.done || !step) {
      return result;
    }
    if (step.type === "note") {
      if (step.message) {
        notes.push(step.message);
      }
      if (step.externalUrl || step.deviceCode) {
        show(step);
      }
      next = { stepId: step.id };
      continue;
    }
    if (step.executor === "gateway") {
      show(step);
      next = undefined;
      continue;
    }
    return result;
  }
}
