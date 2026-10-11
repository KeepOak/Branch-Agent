# Overlay keyboard verification

The screenshots use isolated production QuickAsk, Dialog and Popover components with production theme, frame and feature CSS. The fixture supplies an empty Trunk list and local close callbacks; it does not connect to a gateway.

- Before: Tab from Quick ask's Start button leaves the dialog (active element becomes the body).
- After: Tab and Shift+Tab wrap between the input and Start button; eight repeated Tab presses stay inside. Escape closes and focuses the Quick ask trigger.
- At both 1100 × 740 and 390 × 740: dialog Cancel and Escape return focus to the edit trigger; an empty Person popover closes on Escape and restores its trigger.

The named component tests additionally cover StrictMode, descendant autofocus, nested overlays, removal of the launching menu, simultaneous parent/child dismissal, disabled and hidden controls, empty modals, changing callbacks, and full-size computer dismissal.

These are headless Chromium component checks, not a replay in a connected Windows or macOS desktop app. No camera, file picker, remote computer or send operation was exercised by the screenshot fixture.
