# Proof: no hostnames at Regular (KeepOak/Branch-Agent#1706, Private #1095, walkthrough B-026)

Taken with the installed Chrome against a window dev server built from a branch that contains #1706 through main (main 5f4c739dbb26aebbccb8d491ac52968aa46d8d76).
Branch draws with a stand-in engine (an in-memory fixture), not a live gateway. After load, the page raises the real toast with
"Couldn’t connect to ws://10.0.0.5:18789/gateway" and the second line "Tried studio.local" through notify(), the same path the engine errors take.
At Regular it reads "Couldn’t connect to the link" / "Tried that computer", at 1440 and 390 wide, light and dark. A text scan of each page found no hostname, IP address or URL.

The walkthrough frame B-026 is not reproduced here because it shows the test machine's real hostname.
