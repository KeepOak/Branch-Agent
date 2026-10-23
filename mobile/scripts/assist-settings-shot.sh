#!/usr/bin/env bash
# Check, on the CI emulator, that Branch is offered as the phone's digital
# assistant, and save screenshots as evidence.
#
# Every check below fails the job; nothing is skipped silently:
# - the installed APK declares an assistant entry point (ACTION_ASSIST
#   activity or VoiceInteractionService);
# - Assist settings opens, shows a "Digital assistant app" row, and the picker
#   behind it lists Branch;
# - selecting Branch in that picker makes android.app.role.ASSISTANT hold
#   com.keepoak.branch, verified via `dumpsys role`.
#
# Note: android-31 google_apis RoleShellCommand ships add/remove/clear only —
# `cmd role get-role-holders` returns "Unknown command" even though RoleManager
# works. Do not treat that as a missing cmd role; use dumpsys role instead.
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

# Parse holders= for ROLE from dumpsys role (works on GHA android-31 google_apis).
assistant_holders() {
  adb shell dumpsys role 2>&1 | awk -v role="$ROLE" '
    $0 ~ ("name=" role) { in_role=1; next }
    in_role && /holders=/ {
      line=$0
      sub(/^.*holders=/, "", line)
      gsub(/[[:space:]]+$/, "", line)
      print line
      exit
    }
    in_role && /name=/ { exit }
    in_role && /^\s*\}/ { exit }
  '
}

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

# Tap the centre of the first node whose text matches $1 (ERE).
tap_text() {
  local label="$1" dump="$2"
  local bounds x1 y1 x2 y2 tx ty
  bounds="$(grep -oE "text=\"${label}\"[^>]*bounds=\"\\[[0-9]+,[0-9]+\\]\\[[0-9]+,[0-9]+\\]\"" "$dump" \
    | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -n1)"
  if [[ -z "$bounds" ]]; then
    return 1
  fi
  read -r x1 y1 x2 y2 <<<"$(tr -c '0-9' ' ' <<<"$bounds")"
  tx=$(( (x1 + x2) / 2 )); ty=$(( (y1 + y2) / 2 ))
  echo "Tapping '$label' at $tx,$ty (bounds $bounds)" | tee -a "$ROLE_LOG"
  adb shell input tap "$tx" "$ty"
  return 0
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
  # Tap the preference row ("Default digital assistant app"), not the action-bar title
  # which is also literally "Digital assistant app" and is not the picker entry point.
  if ! tap_text 'Default digital assistant app' "$OUT/assist-settings.xml"; then
    fail "No 'Digital assistant app' row in the Assist settings dump; picker not captured"
  else
    sleep 3
    if capture assist-picker; then
      if grep -qE 'text="Branch[^"]*"' "$OUT/assist-picker.xml"; then
        picker_seen=yes; echo "Branch is listed in the Digital assistant app picker" | tee -a "$ROLE_LOG"
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

# ---- Authoritative: select Branch in the picker, then dumpsys role ----
{
  echo "\$ dumpsys role (before select)"
  adb shell dumpsys role 2>&1
  echo "holders before: $(assistant_holders)"
} >> "$ROLE_LOG"

if [[ "$picker_seen" == yes ]]; then
  # Keep the picker open — do not KEYCODE_BACK before selecting Branch.
  # Title on API 31 google_apis is "Branch Agent"; match any Branch* row.
  branch_bounds="$(grep -oE 'text="Branch[^"]*"[^>]*bounds="\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]"' "$OUT/assist-picker.xml"     | grep -oE '\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' | head -n1)"
  if [[ -z "$branch_bounds" ]]; then
    fail "Branch is listed but its picker row bounds could not be found"
  else
    read -r x1 y1 x2 y2 <<<"$(tr -c '0-9' ' ' <<<"$branch_bounds")"
    tx=$(( (x1 + x2) / 2 )); ty=$(( (y1 + y2) / 2 ))
    echo "Tapping Branch in picker at $tx,$ty (bounds $branch_bounds)" | tee -a "$ROLE_LOG"
    adb shell input tap "$tx" "$ty"
    sleep 2
    # Confirm dialogs (Set as default / OK / Allow) if the image shows one.
    if capture assist-confirm; then
      for confirm in 'Set as default' 'OK' 'Allow' 'Got it'; do
        if tap_text "$confirm" "$OUT/assist-confirm.xml"; then
          sleep 2
          break
        fi
      done
    fi
    sleep 2
  fi
fi

holders="$(assistant_holders)"
{
  echo "\$ dumpsys role (after select)"
  adb shell dumpsys role 2>&1
  echo "holders after: $holders"
  # Diagnostic only — android-31 RoleShellCommand has no get-role-holders.
  echo "\$ cmd role get-role-holders $ROLE (diagnostic; may be Unknown command on API 31)"
  adb shell cmd role get-role-holders "$ROLE" 2>&1 || true
} >> "$ROLE_LOG"

if [[ "$declares_assist" != yes ]]; then
  fail "Role check not attempted: no assistant entry point in the APK (picker: $picker_seen)"
elif [[ "$picker_seen" != yes ]]; then
  fail "Role check not attempted: Branch was not listed in the picker"
elif [[ -z "$holders" ]]; then
  fail "dumpsys role did not report holders for $ROLE after selecting Branch (see assist-role.log)"
elif ! grep -q "$PACKAGE" <<<"$holders"; then
  fail "After selecting Branch in the picker, $ROLE holders are '$holders' (wanted $PACKAGE)"
else
  echo "Android reports $PACKAGE as the $ROLE holder via dumpsys role (picker: $picker_seen)" | tee -a "$ROLE_LOG"
fi

if (( failures > 0 )); then
  echo "::error::$failures assistant check(s) failed (see assist-role.log)"
  exit 1
fi
exit 0
