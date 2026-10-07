#!/bin/sh
# Launch the portable Linux package with a Chromium sandbox.
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sandbox="$app_dir/chrome-sandbox"
# Prefer the unprivileged user-namespace sandbox when the kernel actually permits it.
if command -v unshare >/dev/null 2>&1 && unshare -Ur true >/dev/null 2>&1; then
  exec "$app_dir/Branch Agent.bin" "$@"
fi
if [ -L "$sandbox" ] || [ ! -f "$sandbox" ]; then
  printf '%s\n' "Branch Agent package is incomplete: chrome-sandbox is missing." >&2
  exit 1
fi
if [ "$(stat -c '%u:%a' -- "$sandbox")" != '0:4755' ]; then
  python=/usr/bin/python3
  if [ -x "$python" ]; then
    setup='import hashlib, os, stat, sys
path, owner = sys.argv[1], int(sys.argv[2])
fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
try:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_nlink != 1:
        raise SystemExit("Unsafe chrome-sandbox file")
    digest = hashlib.sha256()
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            break
        digest.update(chunk)
    if digest.hexdigest() != "__BRANCH_SANDBOX_SHA256__":
        raise SystemExit("Unexpected chrome-sandbox contents")
    os.fchown(fd, 0, 0)
    os.fchmod(fd, 0o4755)
finally:
    os.close(fd)'
    if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v pkexec >/dev/null 2>&1; then
      pkexec "$python" -c "$setup" "$sandbox" "$(id -u)" || true
    elif [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
      sudo "$python" -c "$setup" "$sandbox" "$(id -u)" || true
    fi
  fi
fi
if [ -L "$sandbox" ] || [ "$(stat -c '%u:%a' -- "$sandbox")" != '0:4755' ]; then
  message='Branch Agent needs a one-time sandbox setup for this package.
Use a terminal with sudo or a desktop authorization prompt, then launch ./branch-agent again.'
  printf '%s\n' "$message" >&2
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v zenity >/dev/null 2>&1; then zenity --error --title='Branch Agent setup' --text="$message" || true
    elif command -v kdialog >/dev/null 2>&1; then kdialog --error "$message" 'Branch Agent setup' || true
    fi
  fi
  exit 1
fi
exec "$app_dir/Branch Agent.bin" "$@"
