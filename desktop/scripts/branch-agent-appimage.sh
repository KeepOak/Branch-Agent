#!/bin/sh
# AppRun for the Branch Agent AppImage. The image mounts read-only, so its chrome-sandbox cannot become setuid root.
# With unprivileged user namespaces Chromium needs no setuid helper. Without them, a copy of chrome-sandbox outside
# the image, checked against the hash this image was built with, is set up once and Chromium is pointed at it.
set -eu
app_dir=${APPDIR:-$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)}
if command -v unshare >/dev/null 2>&1 && unshare -Ur true >/dev/null 2>&1; then
  exec "$app_dir/Branch Agent.bin" "$@"
fi
sandbox_dir=${XDG_DATA_HOME:-$HOME/.local/share}/branch-agent-sandbox
sandbox=$sandbox_dir/chrome-sandbox-__BRANCH_SANDBOX_SHA256__
if [ -L "$sandbox" ] || [ "$(stat -c '%u:%a' -- "$sandbox" 2>/dev/null || true)" != '0:4755' ]; then
  mkdir -p "$sandbox_dir"
  # Older images' helpers and a half-done copy go; this image's helper is copied fresh.
  for old in "$sandbox_dir"/chrome-sandbox-*; do
    [ -e "$old" ] || [ -L "$old" ] || continue
    rm -f -- "$old"
  done
  cp -- "$app_dir/chrome-sandbox" "$sandbox"
  chmod 0755 "$sandbox"
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
if [ -L "$sandbox" ] || [ "$(stat -c '%u:%a' -- "$sandbox" 2>/dev/null || true)" != '0:4755' ]; then
  message='Branch Agent needs a one-time sandbox setup on this system (unprivileged user namespaces are off).
Use a terminal with sudo or a desktop authorization prompt, then launch Branch Agent again.'
  printf '%s\n' "$message" >&2
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    if command -v zenity >/dev/null 2>&1; then zenity --error --title='Branch Agent setup' --text="$message" || true
    elif command -v kdialog >/dev/null 2>&1; then kdialog --error "$message" 'Branch Agent setup' || true
    fi
  fi
  exit 1
fi
CHROME_DEVEL_SANDBOX=$sandbox
export CHROME_DEVEL_SANDBOX
exec "$app_dir/Branch Agent.bin" "$@"
