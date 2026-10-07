# Verify Changes in the Running App

**Use when:** You need to prove a UI change works by showing it in the actual Branch desktop app, not just passing CI tests.

**Why this exists:** Several agents work on design-parity changes, control placement, and visible behaviors. The real proof is screenshots of the actual running window, which this skill makes reliable and repeatable.

## Quick Start

1. **Use the verification script** to screenshot any screen:
   ```bash
   node scripts/verify-in-app.mjs screenshot "Settings › Usage" screenshots/usage.png
   ```

2. **Add the screenshot to your PR**:
   - Reference it in the PR body with a relative path
   - For cloud agents, use `<img>` tags and ManagePullRequest will upload it

3. **The feature map** (`docs/feature-map.json`) lists every screen and how to reach it.

## How It Works

The verification script:
1. Starts a **scratch Branch instance** on free ports with its own data folder (never touches the running app's ports 19031/19032 or data)
2. Uses the engine's **ui_* tools** (from `engine/src/mcp/ui-tools.ts`) to navigate and screenshot
3. Saves images to the path you specify
4. Cleans up automatically

**Important:** The scratch instance is the same one the ui_* tools drive during `branch mcp serve` testing. It's a full Branch with a test engine, served window build, and Playwright-controlled browser.

## Finding Screens

Every screen, tab, and Settings page is documented in:
- **`docs/feature-map.json`**: Machine-readable map with routes, navigation paths, and source files
- **`docs/feature-map-index.md`**: Human-readable guide

### Navigation Patterns

**Places** (sidebar):
```bash
# Just the place name
node scripts/verify-in-app.mjs screenshot "Overview" screenshots/overview.png
node scripts/verify-in-app.mjs screenshot "Canopy" screenshots/canopy.png
```

**Settings pages** (multi-step):
```bash
# Use › (option+shift+\ on Mac) to chain clicks
node scripts/verify-in-app.mjs screenshot "Settings › Usage" screenshots/usage.png
node scripts/verify-in-app.mjs screenshot "Settings › Advanced" screenshots/advanced.png
```

**Tabs within a place**:
```bash
# Navigate to the place first, then click the tab name
node scripts/verify-in-app.mjs screenshot "Inbox" screenshots/inbox-needs.png
# The default tab loads; to switch tabs, use ui_click separately or navigate twice
```

### Multiple Screenshots

Create a JSON config file:
```json
[
  {"path": "Overview", "output": "screenshots/overview.png", "label": "Overview place"},
  {"path": "Settings › Usage", "output": "screenshots/usage.png", "label": "Usage settings"},
  {"path": "Canopy", "output": "screenshots/canopy.png", "fullPage": true}
]
```

Then run:
```bash
node scripts/verify-in-app.mjs multi-screenshot screens.json
```

## Debugging Navigation

If a navigation step fails, use the `snapshot` command to see what controls are available:

```bash
node scripts/verify-in-app.mjs snapshot "Settings"
```

This prints the accessibility tree with refs and control names. Unnamed controls are listed separately.

## Advanced: Direct ui_* Tool Use

For more control, start a scratch instance and use the ui_* tools directly via the engine's MCP serve or a test script:

```javascript
import { openTestInstance } from "./engine/src/mcp/ui-target.js";
import { locate } from "./engine/src/mcp/ui-tools.js";

const target = await openTestInstance();
const { page } = target;

// Navigate
await locate(page, { name: "Settings" }).click();
await locate(page, { name: "Usage" }).click();

// Screenshot
const image = await page.screenshot();

// Snapshot
const tree = await page.ariaSnapshot({ mode: "ai" });

await target.close();
```

See `engine/src/mcp/ui-tools.ts` and `engine/src/mcp/ui-tools.test.ts` for the full API.

## Rules

1. **Never touch ports 19031/19032** or the running app's data folder. The scratch instance picks its own free ports and temporary data.
2. **Stop by PID, not by name** if you manually spawn processes. The verification script handles this.
3. **Screenshot the full flow** for parity changes: show the same view in both the preview and the real app, side by side.
4. **CI validation**: The feature map's source paths are checked in CI by `scripts/feature-map-check.mjs`. If a file moves, update the map.

## Updating the Feature Map

When you add or move a screen:

1. Edit `docs/feature-map.json`:
   - Add the new place/page/tab with its navigation path and sources
   - Update paths if files moved

2. Run the validation check:
   ```bash
   node scripts/feature-map-check.mjs
   ```

3. Update `docs/feature-map-index.md` if the change affects the quick-reference guide.

## Troubleshooting

**"Branch instance ready" hangs:**
- Check that the engine and window builds are present
- Set `BRANCH_UI_ENGINE_DIR` and `BRANCH_UI_WINDOW_DIR` if needed
- See `engine/src/mcp/ui-target.ts` for environment variables

**"No such control" errors:**
- Use `snapshot` to see available controls
- Check that the navigation path matches the exact visible text
- The separator is `›` (U+203A), not `>` or `›` (U+2018)

**Screenshot is blank or wrong screen:**
- Add a longer wait: edit the script's `waitForTimeout` values
- Check that the route in feature-map.json is correct

**Scratch instance port conflicts:**
- Ports 19031, 19032, and the old preview ports (3210, 3299, 3300, 19021) are forbidden
- The script finds a free port automatically; if it fails 20 times, something else is holding many ports

## Examples

### Example 1: Prove a Settings Page Fix

You fixed a layout bug in Settings › Usage. Prove it works:

```bash
# Take a screenshot of the fixed page
node scripts/verify-in-app.mjs screenshot "Settings › Usage" screenshots/usage-fixed.png

# Add it to the PR body
# For cloud agents: <img src="/workspace/screenshots/usage-fixed.png" alt="Usage settings fixed" />
# ManagePullRequest uploads the image and rewrites the path automatically
```

### Example 2: Design Parity Verification

You ported a change from the Branch App Preview. Show it matches:

1. Screenshot the same view in both:
   ```bash
   # From the preview (manual or via its own tools)
   # Save as screenshots/preview-overview.png

   # From the real app
   node scripts/verify-in-app.mjs screenshot "Overview" screenshots/real-overview.png
   ```

2. Put both images side-by-side in the PR body:
   ```markdown
   ## Design Parity: Overview

   | Preview | Real App |
   |---------|----------|
   | ![Preview](screenshots/preview-overview.png) | ![Real](screenshots/real-overview.png) |

   The Overview health tile, activity summary, and "Finish setup" button now match 1:1.
   ```

### Example 3: Bulk Screenshot for PR

You touched multiple places. Screenshot them all:

```json
// screens.json
[
  {"path": "Overview", "output": "screenshots/overview.png"},
  {"path": "Settings › General", "output": "screenshots/general.png"},
  {"path": "Settings › Usage", "output": "screenshots/usage.png"},
  {"path": "Canopy", "output": "screenshots/canopy.png"}
]
```

```bash
node scripts/verify-in-app.mjs multi-screenshot screens.json
```

Then reference all screenshots in the PR.

## References

- **Feature map**: `docs/feature-map.json`, `docs/feature-map-index.md`
- **Verification script**: `scripts/verify-in-app.mjs`
- **UI tools implementation**: `engine/src/mcp/ui-tools.ts`, `engine/src/mcp/ui-target.ts`
- **UI tools tests**: `engine/src/mcp/ui-tools.test.ts`
- **AGENTS.md rule 9**: Self-test visible changes before opening a PR
