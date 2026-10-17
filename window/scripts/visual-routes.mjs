// The visual harness's named screens. scripts/playwright-visual-routes.mjs captures each one by name, and
// window/scripts/visual-routes.test.mjs checks that every name has a capture step. Add a screen here and in the runner.
export const ROUTES = {
  "room-menu": "A group room's ⋯ conversation menu, opened by clicking the group's row (fixture: Design group).",
  "stage-preview": "The side panel's Preview tab, showing the Ledger app portal (fixture: port 3000).",
  "side-panel-tabs": "The side panel's tab row at its 352 px default width. The capture fails if a tab label is clipped or the row overflows.",
  "steps-overflow": "The expanded work-steps list at 360 px with a very long path, command, URL and output (Private #1103). The capture fails if anything runs past the panel.",
  "pair-overflow": "The Pair a phone dialog at a 420 px window with a very long setup code and link (Private #1103). The capture fails if anything runs past the dialog.",
  "team-approval-before": "The group room as it is on main, with no team proposal card (fixture: Design group).",
  "team-approval": "The team proposal card in its asking state, with Approve team and Not now (fixture: Ship the Q3 newsletter).",
  "computer-screen-before": "The computer pane on this Mac when its capture fails with the driver's JSON-RPC error, as it did on main (Private #1103 item 5).",
  "computer-permission": "The computer pane on this Mac when the capture comes back all black: the Screen Recording ask with Open System Settings (Private #1103 item 5).",
};
