# Desktop restart continuation

The engine exposes three owner-authenticated, profile-dependent admin methods.
This engine-only contract complements the durable desktop adapter; it does not
restart the Gateway, install a build, or wire the desktop lifecycle itself.

## Prepare before stopping

`desktop.continuation.prepare` takes `sessionKey`, `expectedSessionId`,
`targetBuild`, `checkpoint`, and `message`. The exact canonical session must exist
and still have the expected session ID. The Gateway captures its current lifecycle
revision and original delivery route from the session record. Caller route,
requester, authorization, and binding hints are never used.

Success returns `{id, sessionKey, expectedSessionId, targetBuild}`. A stale session
returns `{status:"session-changed"}` instead. The desktop must validate the response
and persist the receipt before stopping the engine. Checkpoint/message text stays
in the engine state directory, not the desktop journal.

Preparing persists an inert receipt under `desktop-restart-continuations` in the
engine state directory. It never creates a startup sentinel or queues a turn.

## Resume after verified candidate readiness

`desktop.continuation.resume` takes `{receipt}`. The Gateway authenticates the owner
again, checks the immutable build identity loaded from runtime build-info against
`targetBuild`, then verifies session ID, lifecycle revision and store ownership.
Changing the default contact never changes this target.

The result is `{status:"accepted"}`, `{status:"session-changed"}`, or
`{status:"cancelled"}`. Acceptance means the original routed agent turn entered the
durable session delivery queue, not that its work finished. A transport/storage
error is an unsuccessful RPC; retry the same receipt rather than preparing a new
one or restarting again.

The queue uses a permanent idempotency key derived from the receipt ID. Queue
publication uses existing session-lifecycle and database commit admission, including
current requester authority. Acceptance is persisted permanently in the receipt,
so a lost acknowledgment can be retried after a later session reset without
replaying work. Concurrent resume/cancel calls are serialized by the durable
receipt lock.

## Cancel a failed candidate

`desktop.continuation.cancel` takes `{receipt}` and returns
`{status:"cancelled"}` or `{status:"accepted"}`. Cancel before rollback boots the
retained engine. An already accepted turn cannot be undone; cancellation does not
claim otherwise. Cancelled receipts never replay, even if the candidate later boots.

## Integration boundary

The desktop lifecycle owner must connect these RPCs to its adapter, preserve the
pending journal through process exit, verify actual candidate readiness/build
identity, and cancel before rollback. Engine startup does not automatically consume
these receipts. Installed restart/rollback/resumed-turn acceptance is a separate
delivery check.

Implementation references: `src/infra/session-delivery-queue-storage.ts`,
`src/infra/session-delivery-queue.records.ts`, and the durable desktop adapter in
`desktop/src/restart-continuation.ts` (the corresponding desktop change).
