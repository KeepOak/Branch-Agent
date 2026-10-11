# DA-88: Check Branch

Captured from the real settings components and production CSS in the isolated frame harness, at 1280×900 and 600×900. The harness supplies a successful health response and an empty memory response; the latter now displays an unreported result instead of success.

- `before.png`: main's Check and fix dialog exposes a repair command and Copy button in Regular settings.
- `after.png`: Check Branch displays read-only, plain-language results without terminal instructions.
- `after-narrow.png`: the same dialog at a narrow viewport.
- `advanced.png`: terminal checks are available only in Advanced/Technical settings.

These are fixture-based UI checks, not connected-engine or released-build verification. Released-build verification remains pending independent merge and release.
