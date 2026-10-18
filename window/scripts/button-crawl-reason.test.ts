import { describe, expect, it } from "vitest";
import { disabledWithoutReason, visibleReason } from "./button-crawl-reason";

// jsdom draws no layout, so the test's visibility check reads only what hides an element: [hidden] and display:none.
const visible = (el: Element) => !el.closest("[hidden]") && (el as HTMLElement).style.display !== "none";
const page = (html: string) => {
  document.body.innerHTML = html;
  return (id: string) => document.getElementById(id) as HTMLElement;
};

describe("button crawl: a greyed control says why in one visible line", () => {
  it("passes a disabled control whose aria-describedby names a visible line", () => {
    const el = page(`<div><button id="go" disabled aria-describedby="why">Run now</button><p id="why">Turn on “Compress older transcripts” first.</p></div>`);
    expect(visibleReason(el("go"), visible)).toBe("Turn on “Compress older transcripts” first.");
    expect(disabledWithoutReason(el("go"), visible)).toBe(false);
  });

  it("passes an aria-disabled control with a visible note in the same row", () => {
    const el = page(`<div class="r1s-row"><b>Backups</b><div class="r1s-ctl"><button id="go" aria-disabled="true">Back up now</button></div><small class="r1s-note">Choose a folder first.</small></div>`);
    expect(disabledWithoutReason(el("go"), visible)).toBe(false);
  });

  it("fails a disabled control whose only reason is a tooltip (title)", () => {
    const el = page(`<div class="r1s-row"><b>Pause</b><button id="go" disabled title="Choose an account first.">Pause</button></div>`);
    expect(disabledWithoutReason(el("go"), visible)).toBe(true);
  });

  it("fails when aria-describedby names a hidden or empty line, or a note inside another control", () => {
    const el = page(`<div class="r1s-row"><button id="a" disabled aria-describedby="gone">A</button><p id="gone" hidden>Why</p>
      <button id="b" disabled aria-describedby="empty">B</button><p id="empty"> </p><button><small>Open</small></button></div>`);
    expect(disabledWithoutReason(el("a"), visible)).toBe(true);
    expect(disabledWithoutReason(el("b"), visible)).toBe(true);
  });

  it("does not count a Coming control hidden below Technical", () => {
    const el = page(`<div hidden><button id="go" aria-disabled="true" data-coming="Pausing an account comes in a later update." title="Pausing an account comes in a later update.">Pause</button></div>`);
    expect(disabledWithoutReason(el("go"), visible)).toBe(false);
  });

  it("ignores an enabled control, with or without a reason", () => {
    const el = page(`<div class="r1s-row"><button id="go" title="Runs now">Run now</button></div>`);
    expect(disabledWithoutReason(el("go"), visible)).toBe(false);
  });
});
