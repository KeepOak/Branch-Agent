# Visual Proof for "Copy into a new conversation" Feature

## What to Capture

### 1. App Screenshots (Real App - this branch)
At 1280px wide, both light and dark themes:
- Row menu open showing **enabled** "Copy into a new conversation" item with 'f' key
- When conversation is working: tooltip showing "From the last finished reply"  
- Result after clicking: new conversation with "(copy)" suffix, toast visible

### 2. Preview Screenshots
From `design/spec-v23/index.html` at 1280px wide, both themes:
- Corresponding menu showing the copy item
- Result after clicking in preview

### 3. Before Screenshot (Old Main)
- Row menu showing **disabled** "Copy into a new conversation" with grey text

## How to Capture (Manual Method)

### Setup
```bash
# Terminal 1: Start scratch engine on free port
cd engine
DATA_DIR=/tmp/branch-test-$(date +%s) PORT=58801 pnpm start

# Terminal 2: Start window dev server
cd window
VITE_GATEWAY_WS=ws://127.0.0.1:58801 pnpm dev

# Terminal 3: Run Playwright
cd /workspace
node scripts/visual-proof-copy-conversation.mjs http://localhost:5173
```

### Via CI
Trigger `.github/workflows/visual-tour.yml` with `parity: true` to generate side-by-side comparison grid.

## Expected Results

**Old Main (before)**:
- Menu item greyed out
- Disabled reason tooltip: "needs an engine call that copies up to the last reply; it doesn't have one yet"

**This PR (after)**:
- Menu item enabled, 'f' keyboard shortcut visible
- Working conversations: hint "From the last finished reply"
- Clicking creates new conversation: "<Original Name> (copy)"
- Toast: "Copied into a new conversation."
- New conversation opens automatically
- Original conversation unchanged

**Preview Match**:
- Naming: `${c.name} (copy)` ✓
- Behavior: fork at last finished reply ✓
- Toast message: "Copied into a new conversation." ✓
- Opens new conversation ✓

## Implementation Verified By Tests

The unit tests (`window/src/shell/copy-conversation.test.tsx`) verify:
1. ✓ `sessions.fork` called with correct `entryId` of last finished entry
2. ✓ When working, finds last assistant entry (not in-progress user message)
3. ✓ `sessions.patch` called to rename with "(copy)" suffix
4. ✓ List refreshed after fork
5. ✓ New conversation opened via callback
6. ✓ Error handling when no finished entries exist

All 3 tests pass: see PR test results.
