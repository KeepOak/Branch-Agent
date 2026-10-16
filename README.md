# Proof for KeepOak/Branch-Agent#1687 (trunk/1095-close-quit)

Captured from PR head 8b7a4ebe217c349ba354b373a0f5d2f89c6cc2b5 on Linux, in a private X display (Xvfb, xfwm4 and xfce4-notifyd).

This is a harness, not the packaged app. It runs the real Electron 44.5.1 with the PR's built `desktop/dist/resident-window.js` and calls the real `keepWindowResident`, with a plain stand-in page in the window and the tray state set to 1 Trunk working. No engine was started.

- `close-notice.png`: the window's close button was pressed (`win.close()`). The PR's close handler hid the window and showed the one-time system notice "Branch closes to the tray."
- `quit-dialog.png`: the window was shown again and Ctrl+Q was pressed on the X keyboard (`xdotool key ctrl+q`). The PR's Quit path showed the question "Quit while 1 Trunk is working?", "If you quit, it stops and picks up next time you open Branch. Keep Branch in the tray to let it finish.", and the buttons "Quit anyway" and "Keep it running in the tray".
