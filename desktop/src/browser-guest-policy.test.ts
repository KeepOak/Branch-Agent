import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyGuestWebPreferences,
  BRANCH_BROWSER_PARTITION,
  guestAttachDecision,
  guestPermissionDecision,
  guestUrlDecision,
  popupDecision,
  r1WebPreferences,
} from "./browser-guest-policy.ts";

test("guest pages may be web pages or about:blank", () => {
  assert.equal(guestUrlDecision("https://keepoak.com/pricing"), "allow");
  assert.equal(guestUrlDecision("http://example.com"), "allow");
  assert.equal(guestUrlDecision("about:blank"), "allow");
  assert.equal(guestUrlDecision(undefined), "allow");
});

test("file, chrome, devtools, javascript and data addresses are blocked", () => {
  for (const url of ["file:///etc/passwd", "chrome://settings", "devtools://devtools/bundled/x", "javascript:alert(1)", "data:text/html,hi", "about:config", "not a url"]) {
    assert.equal(guestUrlDecision(url), "block", url);
  }
});

test("a guest attaches only on the Branch partition and to an allowed page", () => {
  assert.equal(guestAttachDecision({ partition: BRANCH_BROWSER_PARTITION, src: "https://keepoak.com" }), true);
  assert.equal(guestAttachDecision({ partition: "persist:hermes-preview", src: "https://keepoak.com" }), false);
  assert.equal(guestAttachDecision({ partition: undefined, src: "https://keepoak.com" }), false);
  assert.equal(guestAttachDecision({ partition: BRANCH_BROWSER_PARTITION, src: "file:///tmp/x.html" }), false);
});

test("attaching a guest strips the preload and forces the isolation flags", () => {
  const prefs: Record<string, unknown> = {
    preload: "/app/preload.js",
    preloadURL: "file:///app/preload.js",
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    webviewTag: true,
    webSecurity: false,
    partition: "persist:other",
  };
  applyGuestWebPreferences(prefs);
  assert.equal("preload" in prefs, false);
  assert.equal("preloadURL" in prefs, false);
  assert.equal(prefs.partition, BRANCH_BROWSER_PARTITION);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.nodeIntegrationInSubFrames, false);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.webSecurity, true);
  assert.equal(prefs.webviewTag, false);
});

test("a popup opens as a tab only for web pages", () => {
  assert.equal(popupDecision("https://keepoak.com/"), "open-tab");
  assert.equal(popupDecision("file:///etc/passwd"), "deny");
  assert.equal(popupDecision("javascript:void(0)"), "deny");
  assert.equal(popupDecision("nonsense"), "deny");
});

test("every guest permission is refused", () => {
  assert.equal(guestPermissionDecision(), false);
});

test("only the R1 window gets the webview tag, with the isolation flags", () => {
  const prefs = r1WebPreferences("/app/preload.js");
  assert.equal(prefs.webviewTag, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.sandbox, true);
});
