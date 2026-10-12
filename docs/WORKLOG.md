# Worklog

## 2026-10-03 — GitHub account settings

- Adapted the device authorization lifecycle from OpenClaw `ui/src/features/github-connections/github-identity-controller-authorization.ts` (vendored in `engine/ui/src/features/github-connections/`) and Branch gateway `engine/src/gateway/server-methods/tools-github.ts`.
- Connected Accounts settings to real GitHub status, device authorization start/poll/cancel, and scoped inheritance endpoints. No client-side token fields, placeholder mutations, credential copying, or live configuration changes.
- Shared settings show the selected shared identity, not an active Trunk override. Existing work retains engine-owned identity. Authorization cleanup handles scope changes, late starts and cancellation races; retry cadence remains server-owned.
- Added named controller and React interaction checks, including read-only access, authorization completion, per-Trunk inheritance, shared identity display, stale reads and server backoff. Added explicit feature CI/strict targets.
