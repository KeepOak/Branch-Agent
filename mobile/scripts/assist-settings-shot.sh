#!/usr/bin/env bash
# Open Android's "Default digital assistant app" screen on the emulator, save a
# screenshot and a UI dump, and check whether Branch is offered there.
# Fails only when the screen opened, the installed APK declares an assistant
# entry point, and Branch is still missing from the list. Otherwise it warns.
set -uo pipefail
PACKAGE="com.keepoak.branch"
OUT="${1:-assist-shot}"
mkdir -p "$OUT"

declares_assist=no
if adb shell cmd package query-activities -a android.intent.action.ASSIST 2>/dev/null | grep -q "$PACKAGE" \
  || adb shell cmd package query-services -a android.service.voice.VoiceInteractionService 2>/dev/null | grep -q "$PACKAGE"; then
  declares_assist=yes
fi
echo "APK declares an assistant entry point: $declares_assist"

opened=no
for cmd in \
  "am start -W -n 'com.android.settings/.Settings\$ManageAssistActivity'" \
  "am start -W -a android.settings.VOICE_INPUT_SETTINGS" \
  "am start -W -a android.settings.MANAGE_DEFAULT_APPS_SETTINGS"; do
  if adb shell "$cmd" 2>&1 | tee "$OUT/am-start.log" | grep -qE "Status: ok|Complete"; then
    if ! grep -qiE "Error|Exception" "$OUT/am-start.log"; then opened=yes; echo "Opened with: $cmd"; break; fi
  fi
done
sleep 3

adb exec-out screencap -p > "$OUT/assist-settings.png" || echo "::warning::screencap failed"
adb shell uiautomator dump /sdcard/assist-settings.xml >/dev/null 2>&1 \
  && adb pull /sdcard/assist-settings.xml "$OUT/assist-settings.xml" >/dev/null 2>&1 \
  || echo "::warning::uiautomator dump failed"

if [[ "$opened" != yes ]]; then
  echo "::warning::Could not open the Default digital assistant app screen on this emulator"
  exit 0
fi

if grep -qiE 'text="Branch"|text="Branch[^"]*"' "$OUT/assist-settings.xml" 2>/dev/null; then
  echo "Branch is listed on the assistant settings screen"
  exit 0
fi

if [[ "$declares_assist" == yes ]]; then
  echo "::error::Assistant screen opened and the APK declares assist support, but Branch is not listed"
  exit 1
fi
echo "::warning::Branch is not listed (this APK does not declare an assistant entry point)"
exit 0
