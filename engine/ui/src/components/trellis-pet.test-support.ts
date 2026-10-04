import { vi } from "vitest";
import type { ThemeArtwork } from "../../../packages/gateway-protocol/src/theme.ts";
import { t } from "../i18n/index.ts";
import { registerNewSessionSetupEnglish } from "../i18n/locales/en-new-session-setup.ts";
import { resolveTrellisPetMode } from "./trellis-pet-contract.ts";
import "./trellis-pet.runtime.ts";

registerNewSessionSetupEnglish();

type TrellisPetMode = ReturnType<typeof resolveTrellisPetMode>;

export type TrellisPetElement = HTMLElement & {
  gatewayVersion: string | null;
  mode: TrellisPetMode;
  runOutcome: "ok" | "error" | "aborted";
  seed: number;
  soundsEnabled: boolean;
  updateComplete: Promise<boolean>;
  visitsEnabled: boolean;
  residentEnabled: boolean;
  critters: readonly string[];
  critterArtwork: ThemeArtwork["critters"];
};

export function createPet(seed: number, mode: TrellisPetMode = "idle"): TrellisPetElement {
  const element = document.createElement("branch-trellis-pet") as TrellisPetElement;
  element.seed = seed;
  element.mode = mode;
  const wrapper = document.createElement("div");
  wrapper.className = "new-session-page__draft";
  wrapper.innerHTML =
    '<div class="agent-chat__input"><textarea></textarea><div class="agent-chat__composer-footer"><div class="agent-chat__composer-lead"></div><div class="chat-composer-model-control"></div><div class="agent-chat__composer-actions"></div></div></div>';
  wrapper.querySelector("textarea")!.setAttribute("aria-label", t("newSession.messagePlaceholder"));
  const boxes: Array<[string, DOMRect]> = [
    [".agent-chat__input", new DOMRect(0, 100, 720, 120)],
    ["textarea", new DOMRect(14, 114, 692, 28)],
    [".agent-chat__composer-footer", new DOMRect(0, 170, 720, 50)],
    [".agent-chat__composer-lead", new DOMRect(8, 175, 130, 32)],
    [".chat-composer-model-control", new DOMRect(480, 175, 132, 32)],
    [".agent-chat__composer-actions", new DOMRect(620, 175, 84, 32)],
  ];
  for (const [selector, box] of boxes) {
    Object.defineProperty(wrapper.querySelector(selector), "getBoundingClientRect", {
      value: () => box,
    });
  }
  wrapper.querySelector(".agent-chat__input")!.prepend(element);
  document.body.append(wrapper);
  return element;
}

export function spritePresent(element: TrellisPetElement): boolean {
  return element.querySelector(".trellis-pet") !== null;
}

export async function advanceUntil(
  element: TrellisPetElement,
  predicate: () => boolean,
  maxMs: number,
  stepMs = 1000,
): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < maxMs) {
    await vi.advanceTimersByTimeAsync(stepMs);
    elapsed += stepMs;
    await element.updateComplete;
    if (predicate()) {
      return true;
    }
  }
  return predicate();
}

// Cover the maximum first-arrival delay, including the shy familiarity tier.
export async function arrive(element: TrellisPetElement): Promise<void> {
  await advanceUntil(element, () => spritePresent(element), 12_000);
}
