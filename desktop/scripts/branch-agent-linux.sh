#!/bin/sh
# Launch the portable Linux package with Chromium's setuid sandbox enabled.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sandbox="$app_dir/chrome-sandbox"
if [ ! -f "$sandbox" ]; then
  printf '%s\n' "Branch Agent package is incomplete: chrome-sandbox is missing." >&2
  exit 1
fi
if [ "$(stat -c '%u:%a' -- "$sandbox")" != '0:4755' ]; then
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v pkexec >/dev/null 2>&1; then
    chown_cmd=/usr/bin/chown; [ -x "$chown_cmd" ] || chown_cmd=/bin/chown
    chmod_cmd=/usr/bin/chmod; [ -x "$chmod_cmd" ] || chmod_cmd=/bin/chmod
    pkexec "$chown_cmd" root:root "$sandbox" && pkexec "$chmod_cmd" 4755 "$sandbox" || true
  elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    sudo chown root:root "$sandbox" && sudo chmod 4755 "$sandbox" || true
  fi
fi
if [ "$(stat -c '%u:%a' -- "$sandbox")" != '0:4755' ]; then
  message='Branch Agent needs a one-time sandbox setup for this package.
In a terminal, change to the extracted package folder and run:
  sudo chown root:root chrome-sandbox
  sudo chmod 4755 chrome-sandbox
Then launch ./branch-agent again.'
  printf '%s\n' "$message" >&2
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v zenity >/dev/null 2>&1; then zenity --error --title='Branch Agent setup' --text="$message" || true
    elif command -v kdialog >/dev/null 2>&1; then kdialog --error "$message" 'Branch Agent setup' || true
    fi
  fi
  exit 1
fi
exec "$app_dir/Branch Agent.bin" "$@"
