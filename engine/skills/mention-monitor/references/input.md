# Sweep input contract

The helper consumes an object with:

- `watch`: the completed `mention-monitor.json` object.
- `startedAt`, `since`: ISO timestamps defining the inclusive search window.
- `coverage`: source IDs mapped to `checked`, `unavailable`, or `failed`.
- `seenUrls`, `seenStoryKeys`: arrays from prior ledgers (empty on the first run).
- `candidates`: inspected records with `source`, `url`, `publishedAt`, `evidence` (a short excerpt or factual paraphrase containing a watched term), `summary` (one-line paraphrase), `verified`, `thirdParty`, `notable`, `spam`, `bot`, optional `authorUrl` and `storyKey`.

Only verified, notable third-party records explicitly classified as neither spam nor bots can survive. A URL parser cannot establish that a page exists: inspection is the agent's responsibility, and the evidence is the audit trail. The helper requires that evidence but does not substitute for browsing. Keep full scraped pages, credentials, and unnecessary personal data out of the ledger. The output has `digest`, `hits`, `coverage`, and `ledgerFile`; appending preserves multiple sweeps on the same local date.
