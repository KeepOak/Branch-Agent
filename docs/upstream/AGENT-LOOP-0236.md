# AGENT-LOOP-0236: skipped (Letta's approval-conflict protocol does not occur in Branch)

Source: `letta-ai/letta-code@3687ea51f6d11eabc4ad7a7b163c649d023801ba`, `src/agent/turn-recovery-policy.ts`, `src/agent/approval-recovery.ts`, `src/agent/check-approval.ts`.

The upstream maps a Letta server response (a run that ended waiting on an approval that conflicts with a pending one) to a recovery action shared by the TUI and headless modes. Branch's approvals are gateway-owned exec approvals (`engine/src/gateway/exec-approval-manager.ts`). Their retry semantics already answer `same` or `conflict` (`engine/src/gateway/exec-approval-results.ts`, lines 47 and 73), and the gateway never returns the Letta conflict error that the upstream policy matches. A port would have no caller that produces its input.

Unblock: only if Branch adds a server path that can return a conflicting pending approval to a client. Then map that error onto the existing exec-approval results.
