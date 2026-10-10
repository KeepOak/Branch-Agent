# Live room turn-order proof (C04)

Use an existing room with at least two enabled Trunks and authorized subscription access.
This is an explicit live test. Keep raw logs and room/member identifiers outside git.

1. Read `rooms.get` and retain the original rule and `trunksTalk` settings.
2. Coordinate with other room testers. Temporarily use `rooms.rule.set` with
   `everyone` and `trunksTalk: false`. Save `rooms.get` as `room.json`.
3. On a persistent authenticated gateway connection, send one marked test post
   through `rooms.send`, asking for one short reply and no tools or mentions.
   Save the response as `sent.json`. Keep the sending connection open until all
   turns settle; later turns retain the original requester authority.
4. Read `rooms.log` with the sent event sequence as cursor. Save the completed
   exchange as `log.json` (page if needed). Avoid overlapping posts.
5. Run the row-specific extended runner:

   ```sh
   python3 scripts/parity/check-room-turn-order.py room.json sent.json log.json result.json
   ```

   `C04 PASS` requires all enabled Trunks to reply in member order, matching run
   IDs and nonempty text, with each reply before the next start. Failures,
   missing replies, duplicate events and overlapping posts fail. The result
   omits room/member IDs. This does not remeasure other parity rows.
6. Restore the original rule and `trunksTalk`, verify with `rooms.get`, then close
   the test connection. Preserve failed evidence rather than counting starts.

## Failure interpretation

- `Gateway requester authority changed`: verify the sending connection stayed
  open for the entire exchange before retrying.
- `Trunk turn was not started`: the scheduler did not accept a started run.
  Keep the verdict FAIL and inspect session creation/send diagnostics; a
  successful connection or a created conversation is not reply evidence.
- Gateway suspension: retain the original settings and retry restoration after
  recovery. Verify the restored settings before reporting cleanup complete.

## Regression checks

When the running app must remain untouched, exercise the real gateway in scratch
state with the deterministic loopback provider:

```sh
cd engine
node scripts/run-vitest.mjs run src/gateway/server.rooms-turn-order.test.ts
```

This uses three Trunks, a free loopback listener, an isolated data directory, and
one persistent client. It checks alternating start/reply events, matching run
IDs, nonempty replies, member order (not lead order), and earlier-reply context.
The fixture closes both servers and removes its state. A passing scratch test
is regression evidence, **not** a live Builders C04 PASS. After review and
release, the runtime owner runs the live procedure above and records its result.

PR #850 already supplies the turn-order and earlier-reply-context regression:

```sh
cd engine
node scripts/run-vitest.mjs run src/gateway/rooms/methods.test.ts -t 'Trunk turns'
```

Verifier checks (standard-library Python, from repository root):

```sh
python3 -m unittest discover -s scripts/parity -p test_room_turn_order.py -v
```
