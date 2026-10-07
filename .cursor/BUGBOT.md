# BUGBOT.md

Instructions for automated bug detection and fixing.

## Rules

- **FIX** any change that logs credentials or bypasses the redaction helper. Credentials include tokens, API keys, passwords, session tokens, cookies, secrets, bearer tokens, and authorization headers. All logging must use `redactSensitiveText()`, `redactLogRecordForTransport()`, `redactSecrets()`, or similar helpers from `engine/src/logging/redact.ts`.
