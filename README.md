# Proof: Trunk's browser toolbar (Private #1103 item 4)

Side by side with Chrome at the same window size: 1440x900, and 510x844 (Chrome's narrowest window here; 390 isn't possible), in light and dark.
Left: Chrome. Right: Branch's Trunk's browser, built from branch trunk/1103-browser-toolbar.

- `side-by-side-1440-light-tabs.png`, `side-by-side-1440-dark-tabs.png`: two tabs open. Back, forward, reload, the address bar, the tabs, New tab, Page and Tools sit in one row. Computer | Browser and Your browser | Trunk's browser sit in the header.
- `side-by-side-1440-light-empty.png`, `side-by-side-1440-dark-empty.png`: no page open. The empty page has room around it.
- `side-by-side-510-*.png`: phone width. The tabs, Page and Tools wrap under the address bar, so nothing is cut off.

The Branch side renders the stage with a stand-in engine, so a tab shows "Connecting to the recorded browser tab…" instead of a live page.
