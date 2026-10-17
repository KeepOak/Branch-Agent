# Proof: Write a new document opens editable (KeepOak/Branch-Agent#1703, Private #1095, walkthrough B-073)

Built from trunk/1095-new-document at 0b260a971de3935b3a2830594fd77c265decd9bb, run in the installed Chrome against a window dev server.
Component harness, not a full-app run: the Library's Documents tab with the app's CSS at Regular and a stand-in engine (an in-memory fixture answering agents.documents.create, agents.workspace.list/get and agents.documents.set), not a live gateway.
Each image puts the walkthrough frame (before) beside the change, at 1440 and 390 wide, light and dark.

- editor-*: after "Write a new document", the new blank document opens in an editor you can type in.
- saved-*: Save stores the text through agents.documents.set and says "Saved."
- list-*: back in the list, names show without their extension at Regular ("plan", "Untitled document").
