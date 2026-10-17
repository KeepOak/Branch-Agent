# Proof: the Trunk's browser beside Chrome at half-screen widths (Private #1103 item 4)

Each shot puts Chrome on the left and Branch's Trunk's browser on the right, both in a window of the same size (1440, 960, 840 and 720 px wide, 900 px tall), with Branch's list open and folded, in light and dark. `-before` is main at 327209ef; `-after` is branch trunk/1103-browser-side-by-side.

Both sides show the same stand-in article page. The Branch side runs the window's dev server with a stand-in engine: the Trunk's page is a picture of that page rendered at the size of Branch's page area, as the Trunk's own browser is sized to the pane.

Measured on main (list open):

| Window | Page area | Address field | Tabs |
|---|---|---|---|
| 1440 | 1148 px | 287 px | 200 / 174 px |
| 1440, list folded (browser beside the chat) | 772 px | 86 px | 124 / 73 px |
| 960 | 668 px | 43 px | 86 / 51 px |
| 840 | 548 px | 14 px | 29 / 18 px (dots) |
| 720 (list slides over) | 720 px | 94 px | 132 / 77 px |

After this PR:

| Window | Page area | Address field | Tabs |
|---|---|---|---|
| 1440 | 1148 px | 287 px | 200 / 174 px |
| 1440, list folded | 772 px | 515 px | 200 / 174 px |
| 960 (list shows as the rail while the browser is open) | 892 px | 636 px | 200 / 174 px |
| 840 (rail) | 772 px | 516 px | 200 / 174 px |
| 720 | 720 px | 464 px | 200 / 174 px |

No control is cut off at any width, before or after; nothing is removed. Below 900 px the toolbar takes a second row (tabs, New tab, Page and Tools), and the list comes back with the list button.
