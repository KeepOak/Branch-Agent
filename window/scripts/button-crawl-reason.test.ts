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

  it("fails a greyed control whose row has only its own description, a plain small line or an .r1s-msg note (Private #1093)", () => {
    // Settings › History & backups › Back up now and Where's Save passed on these lines alone, with no reason shown.
    const el = page(`<div class="r1s-row"><b>Back up now</b><small class="g-label">Runs in the background; the result shows below.</small>
      <div class="r1s-ctl"><button id="now" disabled>Back up now</button></div></div>
      <div class="r1s-row"><b>Where</b><div class="r1s-ctl"><button id="save" disabled>Save</button><small class="r1s-msg">Branch pushes to its backups branch with your Git sign-in.</small></div></div>
      <div class="prow"><span class="grow"><b>Jan</b><small>Runs on this computer.</small></span><button id="look" disabled>Look for it</button></div>`);
    expect(disabledWithoutReason(el("now"), visible)).toBe(true);
    expect(disabledWithoutReason(el("save"), visible)).toBe(true);
    expect(disabledWithoutReason(el("look"), visible)).toBe(true);
  });

  it("passes a greyed control whose row has a reason line: data-why, .why-k or .r1s-note", () => {
    const el = page(`<div class="r1s-row"><b>Back up now</b><div class="r1s-ctl"><button id="a" disabled>Back up now</button></div><small class="r1s-msg" data-why="">Choose where backups go first.</small></div>
      <div class="prow"><span class="grow"><b>Jan</b><small>Runs on this computer.</small><small class="why-k">Branch can’t look for this runtime yet.</small></span><button id="b" disabled>Look for it</button></div>`);
    expect(visibleReason(el("a"), visible)).toBe("Choose where backups go first.");
    expect(visibleReason(el("b"), visible)).toBe("Branch can’t look for this runtime yet.");
  });

  it("counts a control inside a row drawn greyed as greyed, held to the same rule (Models › Planning and hard problems)", () => {
    const el = page(`<div class="ctl" aria-disabled="true"><b>Planning and hard problems</b><small>When a task has many steps.</small><span class="right"><button id="a">Same as everyday</button></span></div>
      <div class="ctl" aria-disabled="true"><b>Planning model</b><span class="right"><button id="b">Same model</button></span><small class="why-k">Branch can’t change this here yet.</small></div>`);
    expect(disabledWithoutReason(el("a"), visible)).toBe(true);
    expect(disabledWithoutReason(el("b"), visible)).toBe(false);
  });

  it("ignores an enabled control, with or without a reason", () => {
    const el = page(`<div class="r1s-row"><button id="go" title="Runs now">Run now</button></div>`);
    expect(disabledWithoutReason(el("go"), visible)).toBe(false);
  });
});
