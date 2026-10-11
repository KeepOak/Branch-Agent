# C6 Windows live audit (#496, parent #420)

Runner: Windows host (Taofiks_Legion), Windows 10.0.26200, headless Chrome via playwright.
Window: built from KeepOak/Branch-Agent 9e35b78f0 (vite preview, port 5621), desktop bridge injected the way the preload does.
Engine: installed release 0.4.4 engine, isolated scratch profile (own BRANCH_HOME, own token, port 19621). Never the owner's gateway.

Each row: <id>-before.png, <id>-after.png, and for automatic rows <id>-reload.png (fresh load of the same profile, the persisted-state check).
Shortcut "Change" rows also have <id>-after-set.png (after pressing Ctrl Alt Shift 9).
c6-windows.tsv: id, result, before, after, note. results.jsonl: raw per-click records (last record per id wins).
