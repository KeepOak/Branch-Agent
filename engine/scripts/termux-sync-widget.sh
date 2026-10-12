#!/data/data/com.termux/files/usr/bin/bash
# Branch Agent OAuth Sync Widget
# Syncs Claude Code tokens to Branch Agent over SSH
# Place in ~/.shortcuts/ on phone for Termux:Widget

termux-toast "Syncing Branch Agent auth..."

# Run sync on the configured Branch Agent host.
SERVER="${BRANCH_SERVER:-branch-host}"
RESULT=$(ssh "$SERVER" '$HOME/branch/scripts/sync-claude-code-auth.sh' 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    # Extract expiry time from output
    EXPIRY=$(echo "$RESULT" | grep "Token expires:" | cut -d: -f2-)

    termux-vibrate -d 100
    termux-toast "Branch Agent synced! Expires:${EXPIRY}"

    # Optional: restart branch service
    ssh "$SERVER" 'systemctl --user restart branch' 2>/dev/null
else
    termux-vibrate -d 300
    termux-toast "Sync failed: ${RESULT}"
fi
