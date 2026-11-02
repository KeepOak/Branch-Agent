#!/usr/bin/env bash
# Install the signed release APK for the assistant check, then capture settings.
# Invoked as a single android-emulator-runner script line (that action runs each
# line of `script:` as its own `sh -c`, so multiline if/fi cannot live inline).
set -euo pipefail

if [ "${SKIP_ASSIST:-}" = "true" ] || [ -z "${ASSIST_APK:-}" ]; then
  echo "Skipping signed-APK assistant install (no release APK available)."
  exit 0
fi

adb uninstall com.keepoak.branch || true
adb install "$ASSIST_APK"
bash mobile/scripts/assist-settings-shot.sh assist-shot
