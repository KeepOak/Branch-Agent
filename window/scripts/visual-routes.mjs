// The visual harness's named screens. scripts/playwright-visual-routes.mjs captures each one by name, and
// window/scripts/visual-routes.test.mjs checks that every name has a capture step. Add a screen here and in the runner.
export const ROUTES = {
  "room-menu": "A group room's ⋯ conversation menu, opened by clicking the group's row (fixture: Design group).",
  "stage-preview": "The side panel's Preview tab, showing the Ledger app portal (fixture: port 3000).",
  "team-approval-before": "The group room as it is on main, with no team proposal card (fixture: Design group).",
  "team-approval": "The team proposal card in its asking state, with Approve team and Not now (fixture: Ship the Q3 newsletter).",
};
