/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composerContext,
  renderComposer,
  resetComposerTestFixtures,
} from "./composer.test-support.ts";

afterEach(() => {
  resetComposerTestFixtures();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("new-session composer critter visits", () => {
  it("keeps visitor preferences and dismissal refresh connected to Appearance", () => {
    const context = composerContext({ client: null });
    context.theme.settings.trellisPetVisits = false;
    context.theme.settings.trellisPetSounds = true;
    const { composer, rerender } = renderComposer({ context });
    const pet = composer.querySelector<
      HTMLElement & {
        visitsEnabled: boolean;
        soundsEnabled: boolean;
        onVisitsDisabled: () => void;
      }
    >("branch-trellis-pet")!;
    expect(pet.visitsEnabled).toBe(false);
    expect(pet.soundsEnabled).toBe(true);
    context.theme.settings.trellisPetVisits = true;
    rerender();
    expect(pet.visitsEnabled).toBe(true);
    pet.onVisitsDisabled();
    expect(context.theme.refresh).toHaveBeenCalledOnce();
  });

  it("suspends only the resident for a theme without a mascot and passes its visitor catalog", () => {
    const context = composerContext({ client: null });
    const { composer, rerender } = renderComposer({ context });
    const pet = composer.querySelector<
      HTMLElement & {
        visitsEnabled: boolean;
        residentEnabled: boolean;
        critters: readonly string[];
      }
    >("branch-trellis-pet")!;
    expect(pet.visitsEnabled).toBe(true);
    expect(pet.residentEnabled).toBe(true);
    context.theme.branding.mascot = "none";
    context.theme.branding.critters = ["penguin", "fedora"];
    rerender();
    expect(pet.residentEnabled).toBe(false);
    expect(pet.visitsEnabled).toBe(true);
    expect(pet.critters).toEqual(["penguin", "fedora"]);
    expect(context.theme.settings.trellisPetVisits).toBe(true);
    context.theme.branding.mascot = "grove";
    rerender();
    expect(pet.residentEnabled).toBe(true);
    expect(pet.visitsEnabled).toBe(true);
    context.theme.settings.trellisPetVisits = false;
    rerender();
    expect(pet.visitsEnabled).toBe(false);
  });

  it("keeps the visitor cast stable while editing and rerolls only for a new draft or opening", () => {
    const first = renderComposer();
    const visitor = () =>
      first.composer.querySelector<HTMLElement & { seed: number; floorEnabled: boolean }>(
        "branch-trellis-pet",
      )!;
    const initial = visitor();
    const seed = initial.seed;
    expect(initial.parentElement?.classList.contains("agent-chat__input")).toBe(true);
    expect(initial.floorEnabled).toBe(true);
    first.rerender();
    first.rerenderForAgent("resolved-agent");
    expect(visitor()).toBe(initial);
    expect(visitor().seed).toBe(seed);
    const textarea = first.composer.querySelector("textarea")!;
    textarea.value = "A prompt takes priority over the visitors";
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(visitor().seed).toBe(seed);
    expect(visitor().floorEnabled).toBe(false);
    first.rerenderForDraftRoute("draft:two", "");
    expect(visitor().seed).not.toBe(seed);
    expect(visitor().floorEnabled).toBe(true);
    const reopened = renderComposer();
    expect(
      reopened.composer.querySelector<HTMLElement & { seed: number }>("branch-trellis-pet")?.seed,
    ).not.toBe(seed);
  });

  it.each([{ dictationActive: true }, { submitting: true }, { messageLocked: true }])(
    "keeps the critters off the floor while the composer is occupied: %j",
    (state) => {
      const { composer } = renderComposer(state);
      expect(
        composer.querySelector<HTMLElement & { floorEnabled: boolean }>("branch-trellis-pet")
          ?.floorEnabled,
      ).toBe(false);
    },
  );
});
