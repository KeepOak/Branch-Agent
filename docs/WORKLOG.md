# Work log

## 2026-10-03 — Native subscription-account reconciliation

Recovered interrupted native-account changes and reconciled the published account-home branch with main, preserving both CI regression lists. Native registry admission rejects API-key logins. Settled-turn finalization captures the native account home, preserves it across default changes, and requires subscription authentication without forwarding Branch credentials. Tests cover removed-home rejection and immutable capture. Existing-thread account migration and Claude multi-home quota routing are separate unfinished implementation work.

Upstream implementation references: `engine/extensions/codex/src/app-server/native-auth.ts`, `native-accounts.ts`, `auth-bridge.ts`, and `settled-turn-finalizer.ts` in KeepOak/Branch-Agent. Claude native boundaries: `engine/extensions/anthropic/cli-auth-seam.ts` and `cli-backend.ts`.
