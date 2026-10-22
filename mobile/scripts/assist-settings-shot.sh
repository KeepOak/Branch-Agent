#!/usr/bin/env bash
# Check, on the CI emulator, that Branch is offered as the phone's digital
# assistant, and save screenshots as evidence.
#
# Every check below fails the job; nothing is skipped silently:
# - the installed APK declares an assistant entry point (ACTION_ASSIST
#   activity or VoiceInteractionService);
# - Assist settings opens, shows a "Digital assistant app" row, and the picker
#   behind it lists Branch;
# - `cmd role` exists (needs API 30+), `cmd role add-role-holder
#   android.app.role.ASSISTANT` succeeds, and Branch is then the role holder.
# Screenshots and dumps are always saved as evidence.
set -uo pipefail
PACKAGE="com.keepoak.branch"
ROLE="android.app.role.ASSISTANT"
OUT="${1:-assist-shot}"
mkdir -p "$OUT"
: > "$OUT/am-start.log"
ROLE_LOG="$OUT/assist-role.log"
: > "$ROLE_LOG"

warn() { echo "::warning::$*"; }
failures=0
fail() { echo "::error::$*" | tee -a "$ROLE_LOG"; failures=$((failures + 1)); }

declares_assist=no
if adb shell cmd package query-activities -a android.intent.action.ASSIST 2>/dev/null | grep -q "$PACKAGE" \
  || adb shell cmd package query-services -a android.service.voice.VoiceInteractionService 2>/dev/null | grep -q "$PACKAGE"; then
  declares_assist=yes
fi
echo "APK declares an assistant entry point: $declares_assist" | tee -a "$ROLE_LOG"
[[ "$declares_assist" == yes ]] || fail "The installed APK declares no ACTION_ASSIST activity or VoiceInteractionService"

# Save a screenshot and UI dump under the given name.
capture() {
  local name="$1"
  adb exec-out screencap -p > "$OUT/$name.png" || warn "screencap failed ($name)"
  if adb shell uiautomator dump "/sdcard/$name.xml" >/dev/null 2>&1 \
    && adb pull "/sdcard/$name.xml" "$OUT/$name.xml" >/dev/null 2>&1; then
    return 0
  fi
  warn "uiautomator dump failed ($name)"
  return 1
}

# ---- Evidence: Assist settings -> Digital assistant app picker ----
opened=no
for cmd in \
  "am start -W -n 'com.android.settings/.Settings\$ManageAssistActivity'" \
  "am start -W -a android.settings.VOICE_INPUT_SETTINGS" \
  "am start -W -a android.settings.MANAGE_DEFAULT_APPS_SETTINGS"; do
  echo "\$ adb shell $cmd" >> "$OUT/am-start.log"
  attempt="$(adb shell "$cmd" 2>&1)"
  printf '%s\n' "$attempt" | tee -a "$OUT/am-start.log" >/dev/null
  if grep -qE "Status: ok|Complete" <<<"$attempt" && ! grep -qiE "Error|Exception" <<<"$attempt"; then
    opened=yes; echo "Opened with: $cmd"; break
  fi
done
sleep 3

picker_seen=unknown
if [[ "$opened" != yes ]]; then
  fail "Could not open the Assist settings screen on this emulator"
  capture assist-settings || true
elif capture assist-settings; then
  # Find the node whose text is "Digital assistant app" (or its parent row) and tap its centre.
  bounds="$(grep -oE 'text="Digital assistant app"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' "$OUT/assist-settings.xml" \
    | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -n1)"
  if [[ -z "$bounds" ]]; then
    fail "No 'Digital assistant app' row in the Assist settings dump; picker not captured"
  else
    read -r x1 y1 x2 y2 <<<"$(tr -c '0-9' ' ' <<<"$bounds")"
    tx=$(( (x1 + x2) / 2 )); ty=$(( (y1 + y2) / 2 ))
    echo "Tapping 'Digital assistant app' at $tx,$ty (bounds $bounds)"
    adb shell input tap "$tx" "$ty"
    sleep 3
    if capture assist-picker; then
      if grep -qE 'text="Branch[^"]*"' "$OUT/assist-picker.xml"; then
        picker_seen=yes; echo "Branch is listed in the Digital assistant app picker"
      else
        picker_seen=no; fail "Branch is not listed in the Digital assistant app picker"
      fi
    else
      fail "Could not dump the Digital assistant app picker"
    fi
  fi
else
  fail "Could not dump the Assist settings screen"
fi
adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true

# ---- Authoritative: assistant role ----
{
  echo "\$ cmd role get-role-holders $ROLE (before)"
  before="$(adb shell cmd role get-role-holders "$ROLE" 2>&1)"
  echo "$before"
  echo "\$ dumpsys role"
  adb shell dumpsys role 2>&1
} >> "$ROLE_LOG"

if grep -qiE "Unknown command|not found|Can't find service|No shell command implementation" <<<"$before"; then
  fail "'cmd role' is not available on this emulator (needs API 30+); the assistant role could not be verified"
  exit 1
fi

if [[ "$declares_assist" != yes ]]; then
  fail "Role check not attempted: no assistant entry point in the APK (picker: $picker_seen)"
  exit 1
fi

add_out="$(adb shell cmd role add-role-holder "$ROLE" "$PACKAGE" 2>&1)"; add_rc=$?
after="$(adb shell cmd role get-role-holders "$ROLE" 2>&1)"
{
  echo "\$ cmd role add-role-holder $ROLE $PACKAGE (exit $add_rc)"
  echo "$add_out"
  echo "\$ cmd role get-role-holders $ROLE (after)"
  echo "$after"
} >> "$ROLE_LOG"

if [[ $add_rc -ne 0 ]] || grep -qiE "Exception|Error|failed" <<<"$add_out" || ! grep -q "$PACKAGE" <<<"$after"; then
  fail "APK declares assist support, but Android would not make $PACKAGE the assistant (see assist-role.log)"
else
  echo "Android accepted $PACKAGE as the assistant role holder (picker: $picker_seen)" | tee -a "$ROLE_LOG"
fi
if (( failures > 0 )); then
  echo "::error::$failures assistant check(s) failed (see assist-role.log)"
  exit 1
fi
exit 0
