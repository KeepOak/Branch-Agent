# Checkpoint

**Paused by the owner on 2026-10-07 at 18:44 UTC.** No new work goes out until the owner says to resume. The rules for coordinating are in [`AGENTS.md`](../AGENTS.md#coordinating-trunks).

## State at pause

- `main` is at `bb79999e0`, and the last merge was #444. 125 PRs are open.
- Dispatch is stopped and every Trunk's queue is empty. One brief has been set aside without being sent: Birch, #445 F1-F4 (below).
- The coordinator's review agent, the PR watcher and the dispatch loop are stopped. The #380 review was stopped before it gave a verdict.

## Priority 1: seamless updates (P45)

14 of 16 pieces are merged. What's left, in order:

1. **#380**: post-update notice ("Branch updated to <version> while you worked.") with Undo. Head `3838f7ca2`.
   - The earlier reviews' fixes are in:
     - B1: the "Updating Branch..." bar no longer gets stuck when automatic updates fail.
     - S1: no "Update postponed" during Undo.
     - B2: Undo no longer offers the previous engine as a new update.
   - Still needs a final review of `3838f7ca2`.
   - CI is red only because the macOS native job hit its 15-minute cap during `pnpm install`, which is an infrastructure problem. Re-run it and review before merging.
2. **#429**: real two-engine handoff test (Elm). It's still a draft, and it's the gate for step 3.
3. A one-line PR that turns `seamlessHandoff` on.
4. A live test mid-conversation, then one last old-style update on each install.

## Other open work

| PR | Head | State | Next step |
|:--|:--|:--|:--|
| #445 desktop profile migration (Birch) | `c3661ba07` | CLEAN, verdict FIX | R4 data loss is fixed. Four items remain (see below), then re-review. |
| #441 topic row 1:1 with preview (Spruce) | `fda4bf610` | CLEAN | Builder finished; review this head with full-layout screenshots. |
| #438 each Trunk's look in Grove (Cedar) | `f8469273a` | review said FIX | Emoji and colourless Trunks still look identical. Fix not pushed yet. |
| #436 Mac control restart without applying updates (Cedar) | `2ae64a523` | review said FIX | The secret still leaks into Trunk shells. Fix not pushed yet. |
| #446 startup bulk audit | `28544717f` | draft | Share the numbers with the owner. |
| macOS packaging job | | not assigned | It hits the 15-minute CI cap. Split it or shard it. |

### #445: remaining items (the brief set aside)

- **F1, `desktop/src/profile-migration.ts:144-146` (blocker).** If the progress file is corrupt, `JSON.parse` throws. The migration then fails on every launch, no marker is written, and the hot-update handoff is refused. Fix: wrap the read in try/catch, accept only an array of the four bootstrap names, and fall back to an empty set.
- **F2, `:63` and `:151` (regression vs main).** The exact-name lookup breaks on case-insensitive file systems. Fix: `existing.has(name) || lstatSync(to, { throwIfNoEntry: false })`.
- **F3, `:22-27` and `:68`.** Replaced files land inside the live workspace. Fix: move them to `.branch/.migration-replaced/<stamp>/workspace/<name>`.
- **F4, tests.** Add tests for a missing progress file, a corrupt one, `.migration-replaced`, an edit made after launch 1 that survives launches 2 and 3, and a case clash. Tests must not depend on readdir order.

## Resume steps

1. Read this file and the rules in `AGENTS.md`.
2. Check the current head and CI of each PR above. Builders may have pushed since this checkpoint.
3. Re-run #380's macOS native job, review the current head, and merge if the verdict is MERGE.
4. Send the #445 F1-F4 brief to Birch, review #441, and get the #438 and #436 fixes pushed.
5. Check the replies on briefs that finished without a PR: Ash (Settings greyed-out toggles), Maple (Copy version info / request ID, login take-over, Tailscale remote access), Oak (rebases of the old security PRs #118 #112 #113 #16/#65).
6. When #429 is merged, open the one-line PR that turns `seamlessHandoff` on.
