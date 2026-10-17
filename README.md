# Proof: conversation rows (KeepOak/Branch-Agent#1699, Private #1095)

Built from trunk/1095-conversation-rows at 5618799d9dab6746fcd03968e702b601ea808369, run in the installed Chrome against a window dev server.
Branch draws with a stand-in engine (an in-memory fixture that answers sessions.create, sessions.patch, agents.update and the list calls), not a live gateway.
Each image puts the walkthrough frame (before, from the 2026-10-16 walkthrough) beside the change, at 1440 and 390 wide, light and dark.

- new-conversation-*: "New conversation with Juniper" makes a real empty thread; it opens at once as "New conversation" with the toast (B-091).
- thread-menu-*: right-click on that thread: Rename…, Change icon…, Pin, Mute, Close, Delete…, drawn over the whole window (B-091, B-096).
- trunk-rename-*: a Trunk row's Rename opens a name box over the list instead of People and Edit Juniper (B-093, B-094).
