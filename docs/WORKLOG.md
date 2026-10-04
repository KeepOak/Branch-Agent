# Work log

## 2026-10-03 — Native subscription-account reconciliation

Recovered interrupted native-account changes and reconciled the published account-home branch with main, preserving both CI regression lists. Native registry admission rejects API-key logins. Settled-turn finalization captures the native account home, preserves it across default changes, and requires subscription authentication without forwarding Branch credentials. Tests cover removed-home rejection and immutable capture. Existing-thread account migration and Claude multi-home quota routing are separate unfinished implementation work.

Upstream implementation references: `engine/extensions/codex/src/app-server/native-auth.ts`, `native-accounts.ts`, `auth-bridge.ts`, and `settled-turn-finalizer.ts` in KeepOak/Branch-Agent. Claude native boundaries: `engine/extensions/anthropic/cli-auth-seam.ts` and `cli-backend.ts`.
## 2026-10-03 — GitHub account settings

- Adapted the device authorization lifecycle from OpenClaw `ui/src/features/github-connections/github-identity-controller-authorization.ts` (vendored in `engine/ui/src/features/github-connections/`) and Branch gateway `engine/src/gateway/server-methods/tools-github.ts`.
- Connected Accounts settings to real GitHub status, device authorization start/poll/cancel, and scoped inheritance endpoints. No client-side token fields, placeholder mutations, credential copying, or live configuration changes.
- Shared settings show the selected shared identity, not an active Trunk override. Existing work retains engine-owned identity. Authorization cleanup handles scope changes, late starts and cancellation races; retry cadence remains server-owned.
- Added named controller and React interaction checks, including read-only access, authorization completion, per-Trunk inheritance, shared identity display, stale reads and server backoff. Added explicit feature CI/strict targets.
