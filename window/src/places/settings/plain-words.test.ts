// Plain words at Regular and Advanced: the engine's thinking levels, project folder names. Technical keeps the raw ids.
import { describe, expect, it } from "vitest";
import { plainThinking } from "./set1/models-data";
import { plainProjectName } from "./set1/general";

describe("plainThinking", () => {
  const levels = [{ id: "low", label: "low" }, { id: "xhigh", label: "xhigh" }, { id: "ultra", label: "ultra" }, { id: "custom-x", label: "Custom" }];

  it("shows plain words, and keeps the stored id", () => {
    const plain = plainThinking(levels, false);
    expect(plain.map((o) => o.label)).toEqual(["Quick", "Very thorough", "Ultra", "Custom"]);
    expect(plain.map((o) => o.id)).toEqual(["low", "xhigh", "ultra", "custom-x"]);
  });

  it("shows the raw id after the word at Technical", () => {
    expect(plainThinking(levels, true)[1].label).toBe("Very thorough (xhigh)");
  });
});

describe("plainProjectName", () => {
  it("turns a folder slug into words", () => {
    expect(plainProjectName("haggle-bot", false)).toBe("Haggle bot");
    expect(plainProjectName("mac-builder-1", false)).toBe("Mac builder 1");
  });

  it("keeps the folder name at Technical, and leaves names that are not slugs alone", () => {
    expect(plainProjectName("haggle-bot", true)).toBe("haggle-bot");
    expect(plainProjectName("Quarterly numbers", false)).toBe("Quarterly numbers");
  });
});
