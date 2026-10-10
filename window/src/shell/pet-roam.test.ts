import { describe, expect, it, vi } from "vitest";
import { getToasts } from "./notify";
import { headerFace, stopRoaming } from "./pet-roam";

describe("the header face while the pet roams", () => {
  it("stops the roam, shows the card, and offers Undo that starts the roam again", () => {
    const set = vi.fn(async () => undefined);
    const showCard = vi.fn();
    const toggle = vi.fn();
    headerFace(true, { set }, showCard, toggle);
    expect(set).toHaveBeenCalledWith("roam", false);
    expect(showCard).toHaveBeenCalledOnce();
    expect(toggle).not.toHaveBeenCalled();
    const toast = getToasts().at(-1);
    expect(toast?.text).toBe("Back on the card.");
    expect(toast?.action?.label).toBe("Undo");
    toast?.action?.run();
    expect(set).toHaveBeenLastCalledWith("roam", true);
  });

  it("toggles the card as before when the pet is not roaming", () => {
    const set = vi.fn(async () => undefined);
    const showCard = vi.fn();
    const toggle = vi.fn();
    headerFace(false, { set }, showCard, toggle);
    expect(toggle).toHaveBeenCalledOnce();
    expect(set).not.toHaveBeenCalled();
    expect(showCard).not.toHaveBeenCalled();
  });

  it("the pet menu's Stop roaming does the same as the header face", () => {
    const set = vi.fn(async () => undefined);
    const showCard = vi.fn();
    stopRoaming({ set }, showCard);
    expect(set).toHaveBeenCalledWith("roam", false);
    expect(showCard).toHaveBeenCalledOnce();
  });
});
