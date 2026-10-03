// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { approvalKeyFor } from "./approval-keys";

afterEach(() => {
  document.body.innerHTML = "";
});

const press = (key: string, target: EventTarget | null, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ key, target, ctrlKey: true, metaKey: false, shiftKey: false, ...mods });

describe("approval keys: one press does one thing", () => {
  it("Ctrl Enter in a message box holding a draft is the box's send, not an allow", () => {
    const box = document.body.appendChild(document.createElement("textarea"));
    box.setAttribute("data-has-draft", "");
    expect(approvalKeyFor(press("Enter", box))).toBeNull();
  });
  it("Ctrl Enter anywhere else, or in an empty message box, allows the waiting request once", () => {
    const empty = document.body.appendChild(document.createElement("textarea"));
    expect(approvalKeyFor(press("Enter", empty))).toBe("allow-once");
    expect(approvalKeyFor(press("Enter", document.body))).toBe("allow-once");
    expect(approvalKeyFor(press("Enter", null))).toBe("allow-once");
    expect(approvalKeyFor(press("Enter", document.body, { ctrlKey: false, metaKey: true }))).toBe("allow-once");
  });
  it("Ctrl Shift Enter always allows and Ctrl D says no, even from a draft (the box uses neither)", () => {
    const box = document.body.appendChild(document.createElement("textarea"));
    box.setAttribute("data-has-draft", "");
    expect(approvalKeyFor(press("Enter", box, { shiftKey: true }))).toBe("allow-always");
    expect(approvalKeyFor(press("d", box))).toBe("deny");
    expect(approvalKeyFor(press("Enter", box, { ctrlKey: false }))).toBeNull();
  });
});
