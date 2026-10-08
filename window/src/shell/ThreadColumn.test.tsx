import { describe, expect, it } from "vitest";
import { shouldShowThreadColumn } from "./ThreadColumn";

const shown = {
  chat: true,
  focus: false,
  stage: false,
  draft: false,
  generalKey: "agent:oak:main",
  topicRow: false,
};

describe("v23 thread column versus the preview topic row", () => {
  it("keeps main's column when a contact has no topic row, and yields once the preview row is mounted", () => {
    expect(shouldShowThreadColumn(shown)).toBe(true);
    expect(shouldShowThreadColumn({ ...shown, topicRow: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, generalKey: null })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, chat: false })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, focus: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, stage: true })).toBe(false);
    expect(shouldShowThreadColumn({ ...shown, draft: true })).toBe(false);
  });
});
