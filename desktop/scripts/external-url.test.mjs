import assert from "node:assert/strict";
import test from "node:test";
import { externalUrlAllowed, MAC_SCREEN_RECORDING_SETTINGS } from "../dist/external-url.js";

// Private #1103 item 5: the computer pane's Open System Settings reaches the Screen Recording pane, and nothing else
// outside the web gets out of the window.
test("the window may open web pages and the Screen Recording pane, nothing else", () => {
  assert.equal(MAC_SCREEN_RECORDING_SETTINGS, "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
  assert.equal(externalUrlAllowed("https://github.com/KeepOak/Branch-Agent"), true);
  assert.equal(externalUrlAllowed(MAC_SCREEN_RECORDING_SETTINGS), true);
  for (const url of ["http://example.com", "file:///etc/passwd", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture&x=1", "javascript:alert(1)", "smb://host/share"]) {
    assert.equal(externalUrlAllowed(url), false, url);
  }
});
