# Accounts selection control

Before and after: the real `AccountsPage` and production Settings/theme/shell styles, rendered in an isolated React preview with two synthetic ChatGPT subscription accounts (Personal and Work). No real account data is shown.

- Desktop: 1000 × 800, light theme.
- Narrow: 390 × 800, dark theme.
- Both widths were also checked in the opposite theme.
- Before uses main's unchanged selection component and stylesheet; after uses this branch. The preview data and styles are otherwise identical.
- The new button uses the existing Settings `Btn` component. Computed text/background contrast is 17.1:1 light and 14.3:1 dark, compared with 5.1:1 and 5.8:1 for the old muted text against the page background.
- Browser assertions checked a visible border, minimum 28px height, label fit, viewport containment, Space activation, pressed state, account selection, reorder to the top, Enter to finish, and clearing selection on re-entry.
- Reorder uses an in-memory `models.authOrderSet` fixture; this is component/browser evidence, not a connected-engine or installed-release verification. Those remain pending release and independent live verification.

The named Accounts test file also verifies the real request parameters for reorder/sign-out. The new selection-toggle regression fails against main and passes with the change.
