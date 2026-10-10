#!/usr/bin/env python3
"""Verify one live everyone-room exchange from gateway JSON, without sending messages."""
import argparse
import json
from pathlib import Path


def check(room, sent, events):
    room_id = room["roomId"]
    post = sent["event"]
    members = [m["id"] for m in sorted(room["members"], key=lambda m: m["order"])
               if m["kind"] == "trunk" and m["enabled"]]
    if room["rule"] != "everyone" or len(set(members)) < 2:
        raise ValueError("capture an everyone room with at least two enabled Trunks")
    if post["roomId"] != room_id or post["kind"] != "message" or not sent["runStarted"]:
        raise ValueError("send receipt does not identify a started room post")
    following = [e for e in events if e["roomId"] == room_id and e["seq"] > post["seq"]]
    if [e["seq"] for e in following] != sorted(set(e["seq"] for e in following)):
        raise ValueError("events must have unique, increasing sequence numbers")
    # A second post makes attribution ambiguous: do not combine separate exchanges.
    if any(e["kind"] == "message" for e in following):
        raise ValueError("another post overlaps this observation; capture an isolated exchange")
    turns = [e for e in following if e["kind"].startswith("turn.")]
    expected = [(kind, actor) for actor in members for kind in ("turn.started", "turn.replied")]
    if [(e["kind"], e["actorId"]) for e in turns] != expected:
        raise ValueError("incomplete, failed, overlapping, or out-of-order Trunk turns")
    if turns[0]["payload"].get("runId") != sent.get("runId"):
        raise ValueError("first turn does not match the send receipt")
    for start, reply in zip(turns[::2], turns[1::2]):
        run_id = start["payload"].get("runId")
        if not run_id or reply["payload"].get("runId") != run_id:
            raise ValueError("reply does not match its started run")
        if not reply["payload"].get("text", "").strip():
            raise ValueError("empty reply")
    return {"id": "C04", "verdict": "PASS", "completed_replies": len(members),
            "evidence": "All enabled Trunks replied in member order; each reply precedes the next start."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("room", type=Path, help="rooms.get JSON captured before sending")
    parser.add_argument("sent", type=Path, help="rooms.send JSON receipt")
    parser.add_argument("log", type=Path, help="rooms.log JSON after replies complete")
    parser.add_argument("output", type=Path, help="sanitized C04 result JSON")
    args = parser.parse_args()
    try:
        result = check(json.loads(args.room.read_text())["room"],
                       json.loads(args.sent.read_text()), json.loads(args.log.read_text())["events"])
    except (ValueError, KeyError, TypeError) as error:
        result = {"id": "C04", "verdict": "FAIL", "evidence": str(error)}
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"C04 {result['verdict']}: {result['evidence']}")
    return 0 if result["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
