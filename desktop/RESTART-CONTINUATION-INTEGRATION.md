# Proposed durable desktop restart adapter

This is an **unwired, tested adapter**, not an implemented desktop auto-resume feature.
It adds no lifecycle hooks, RPC methods, renderer API, release artifacts, or installed
configuration. Existing desktop ownership stays with the packaging/lifecycle lane.

## Required engine implementation

`RestartContinuationEngine` is an injected contract, not the name of existing RPCs.
Do not map it to `update.run` (that updates a separate lifecycle), a generic restart,
or a raw sentinel write.

The old engine must authenticate the owner and durably prepare a checkpoint with
exact canonical session key, current session ID/lifecycle revision, requester and
delivery route, channel/account/thread, original owner binding, continuation text,
and immutable target build identity. Issue a unique non-secret receipt ID; preparing
must NOT enqueue a turn or create an auto-consumed startup sentinel. No credentials
or caller-supplied authorization may be trusted from renderer data. The desktop
journal contains only receipt/binding references, not task text or tokens.

After the new engine is ready, it must resolve that persisted receipt, reauthorize
the ORIGINAL requester, verify current session ID AND lifecycle revision, retain
original delivery routing, and durably enqueue via the existing session delivery
queue. Use a permanent idempotency key derived from the receipt ID. Its reply means
durable queue acceptance, not turn completion. Return `session-changed` for stale
binding; reject transient errors so launcher recovery can retry the same receipt.
Never select the new default Trunk as a replacement for the original session.

This protocol needs a persisted engine receipt store and owner-authenticated
prepare/resume endpoints. They do not exist as part of this patch. Engine startup
must not consume an unconfirmed desktop receipt, including when rollback boots the
old engine. Completed receipt IDs must be retained to handle a lost acknowledgment.

## Exact desktop integration points (owner lane)

1. `main.ts`: instantiate one `RestartContinuation` after `loadConfig`, under the
   existing Electron single-instance lock. Journal path is a new file under
   `cfg.dataDir`, not the engine sentinel. Inject the implemented, authenticated
   engine adapter. If unavailable, disable conversational restart rather than
   reporting resume success; keep ordinary owner-requested restart behavior honest.
2. `preload.ts` / canonical renderer: expose a narrowly scoped explicit restart
   request with session binding + checkpoint. Keep info/token exposure origin-bound.
   `ipcMain.on("branch-desktop:restart-engine", ...)` must reject a sender outside
   the exact served origin and require the authenticated owner. Existing restart
   IPC currently does not capture any session binding and cannot infer it safely.
3. `restartEngine`: guard concurrent calls for the WHOLE lifecycle, not only the
   adapter operation. Run `await continuation.prepare(request)` BEFORE `stopGateway`.
   Preparation/journal failure aborts without stopping. Then stop only owned PID,
   await port release, and boot the selected candidate. Do not overwrite pending work.
4. `bootSelectedEngine`: in the failed-candidate catch, call
   `await continuation.afterBoot({succeeded:false,runningBuild:failedBuild})`
   BEFORE restoring components/booting retained engine. If journal cancellation
   fails, do not proceed into a state that might replay an unconfirmed request.
5. On successful candidate readiness AND verified actual immutable build identity,
   call `await continuation.afterBoot({succeeded:true,runningBuild:verifiedBuild})`.
   Do not use a pathname, pointer, arbitrary version, or renderer observation as
   immutable build verification. Call this on normal launcher startup too, after
   component-update journal recovery has resolved candidate vs rollback outcome.
6. On transient resume failure, retain the ready journal and retry with a bounded
   retry/backoff loop or later launcher recovery. Do not mark the upgrade failed,
   silently drop the continuation, or trigger another component installation.
   Completion remains engine-owned and survives acknowledgment loss.

The adapter assumes one lifecycle owner. It rejects concurrent adapter calls but
does not replace Electron's single-instance lock or a main-level restart mutex.
Writes use a flushed same-directory temporary file plus atomic rename. This is
process-crash recovery; it does not promise transactional power-loss guarantees
across an engine database and desktop filesystem. On unreadable/corrupt journals
it fails closed without discarding records.

## Source verification vs delivery acceptance

Strict standalone TypeScript build and 12 named Node tests cover file persistence,
new-process recovery, no replay before verified target readiness, rollback cancel,
stale-session rejection, corrupt journal, prepare failure/binding mismatch,
concurrency, and duplicate replay after a lost acknowledgment. Engine bindings,
authorization, durable queue and idempotency are injected test contracts, not live
engine acceptance; no claim of real account/channel continuation follows.

Installed launcher 0.4.1 lacks the component updater; no real component release
exists at the review checkpoint. After integration, delivery still needs reviewed
coherent source/artifacts, coordinated bootstrap, real immutable release publication,
update/rollback proof and an actual resumed agent turn with the retained route.
