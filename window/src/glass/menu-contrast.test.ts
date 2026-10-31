import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

// The styles a menu actually ships with, in the order the window loads them, then the shared contrast layer.
const sheets = [
  "src/theme/tokens.css",
  "src/theme/base.css",
  "src/glass/glass.css",
  "src/shell/menu.css",
  "src/shell/frame.css",
  "src/composer/composer.css",
  "src/screens/frame/frame.css",
  "src/screens/chat/chat.css",
  "src/screens/composer/composer.css",
  "src/screens/sidebar/sidebar.css",
  "src/glass/menu-contrast.css",
];

const html = `
<div class="g-popover g-float"><div class="r1c-conv g-clear"><div class="g-menu" role="menu" aria-label="Conversation">
  <button type="button" class="g-menu-row" role="menuitem" id="conv-on"><span class="g-menu-ico">+</span><span class="g-menu-label">Check memory again</span></button>
  <button type="button" class="g-menu-row" role="menuitem" id="conv-hint"><span class="g-menu-ico">+</span><span class="g-menu-label">Rename</span><span class="g-menu-end"><small>in Edit Trunk</small></span></button>
  <button type="button" class="g-menu-row" role="menuitem" id="conv-off" aria-disabled="true"><span class="g-menu-ico">+</span><span class="g-menu-label">Split right<small>later</small></span></button>
  <button type="button" class="g-menu-row" role="menuitem" id="conv-bad" data-danger=""><span class="g-menu-ico">+</span><span class="g-menu-label">Delete…</span></button>
</div></div></div>
<div class="pop menu" role="menu" aria-label="Memory">
  <button type="button" class="mi" role="menuitem" id="mi-on"><i class="mi-ico">+</i><span>Check memory again</span></button>
  <button type="button" class="mi" role="menuitem" id="mi-off" disabled><span>Tidy up</span></button>
  <button type="button" class="mi bad" role="menuitem" id="mi-bad"><span>Delete…</span></button>
</div>
<div class="g-popover"><div class="r1c-menu" role="menu">
  <button type="button" class="c-mi" role="menuitem" id="cmi-on"><span class="c-mi-ic">+</span><span class="c-mi-t">Attach files</span></button>
  <button type="button" class="c-mi" role="menuitem" id="cmi-off" disabled><span class="c-mi-t">Take a screenshot</span></button>
</div></div>
<div class="g-popover"><div class="r1c-plus" role="menu">
  <button type="button" class="r1c-tile" role="menuitem" id="tile-on"><svg></svg><span>Attach</span></button>
  <button type="button" class="r1c-mi" role="menuitem" id="rmi-on"><span class="r1c-ico">+</span><span class="r1c-mi-t">New conversation</span></button>
  <button type="button" class="r1c-mi" role="menuitem" id="rmi-off" aria-disabled="true"><span class="r1c-mi-t">Coming later</span></button>
</div></div>
<div class="g-popover"><div class="r1c-menu" role="menu">
  <button type="button" class="r1c-mi" role="menuitem" id="chat-on"><svg></svg><span class="r1c-mi-t">Copy</span></button>
  <button type="button" class="r1c-mi" role="menuitem" id="chat-off" aria-disabled="true"><span class="r1c-mi-t">Off</span></button>
</div></div>
<div class="g-popover"><div class="r1sb-pop"><div class="g-menu" role="menu">
  <button type="button" class="g-menu-row" role="menuitem" id="sb-on"><span class="g-menu-ico">+</span><span class="g-menu-label">Pin to top</span></button>
  <button type="button" class="g-menu-row" role="menuitem" id="sb-off" aria-disabled="true"><span class="g-menu-label">Archive</span></button>
  <button type="button" class="g-menu-tile" role="menuitem" id="tile-off" data-off="" aria-disabled="true"><span class="g-menu-tile-label">Off</span></button>
</div></div></div>`;

function mount() {
  const style = document.createElement("style");
  style.textContent = sheets.map((file) => readFileSync(file, "utf8")).join("\n");
  document.head.append(style);
  document.body.innerHTML = html;
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const colorOf = (selector: string) => getComputedStyle(document.querySelector(selector)!).color;
const opacityOf = (selector: string) => Number(getComputedStyle(document.querySelector(selector)!).opacity);

describe("menu contrast", () => {
  it("enabled rows are not muted and disabled rows are", () => {
    mount();
    const full = colorOf("#conv-on");
    expect(full).toBe("var(--ink)");
    const enabled = ["#conv-on", "#conv-on .g-menu-label", "#conv-on .g-menu-ico", "#mi-on", "#mi-on .mi-ico", "#mi-on span", "#cmi-on", "#cmi-on .c-mi-t", "#cmi-on .c-mi-ic", "#tile-on", "#rmi-on", "#rmi-on .r1c-mi-t", "#rmi-on .r1c-ico", "#chat-on", "#chat-on .r1c-mi-t", "#chat-on svg", "#sb-on", "#sb-on .g-menu-label", "#sb-on .g-menu-ico"];
    for (const selector of enabled) {
      expect(colorOf(selector), selector).toBe(full);
      expect(opacityOf(selector), selector).toBe(1);
    }
    expect(colorOf("#conv-hint .g-menu-end small")).toBe("var(--ink-3)");
    expect(colorOf("#conv-bad")).toBe("var(--bad)");
    expect(colorOf("#conv-bad .g-menu-ico")).toBe("var(--bad)");
    expect(opacityOf("#conv-bad")).toBe(1);
    expect(colorOf("#mi-bad")).toBe("var(--bad)");
    for (const selector of ["#conv-off", "#mi-off", "#cmi-off", "#rmi-off", "#chat-off", "#sb-off", "#tile-off"]) {
      expect(opacityOf(selector), selector).toBeLessThan(1);
    }
  });
});
