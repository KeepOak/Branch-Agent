// Settings › Privacy & data: the approved preview's seven cards (preview.html PG privacy), in order and at the preview's
// levels. Each card draws the Classic sections the preview maps to it (Classic Data & usage, Advanced's Sharing, more and
// Self's conversation storage), as Classic's own blocks without their Classic headings (privacy-live.tsx). The spend
// card and the allowance list are not here: Usage by account lives on Accounts & usage (#1518).
import type { Row } from "../rows";

const block = (id: string, card: string, level: 0 | 1 | 2, calls: string[] = ["config.get", "config.patch"]): Row =>
  ({ id, page: "privacy", card, label: card, level, control: "custom", bare: true, source: { kind: "slot", calls, reason: `${card} comes in a later update.` } });
/** A Coming row says only that it comes later, in the row's own words (R1-10); the call it waits for stays in `need`. */
const coming = (id: string, card: string, label: string, need: string, help?: string): Row =>
  ({ id, page: "privacy", card, label, level: 0, control: "custom", ...(help ? { help } : {}), source: { kind: "coming", need, reason: `${label} comes in a later update.` } });

const ARCHIVED = "Archived & Recently deleted";
export const PRIVACY_ROWS: Row[] = [
  block("privacy.data.block", "Your data", 0),
  block("privacy.keeping.block", "Keeping things", 0),
  coming("privacy.archived.keep", ARCHIVED, "Keep archived conversations", "engine: how long archived conversations are kept"),
  coming("privacy.archived.empty-after", ARCHIVED, "Empty Recently deleted after", "sessions.restore", "Deleted conversations wait here so you can bring them back."),
  coming("privacy.archived.recently", ARCHIVED, "Recently deleted", "sessions.restore"),
  block("privacy.conversations.block", "Conversations", 1, ["config.get", "config.patch", "sessions.storage.status", "sessions.storage.run"]),
  block("privacy.moving.block", "Moving in and out", 0),
  block("privacy.flagged.block", "Flagged replies", 0),
  block("privacy.money.block", "Money and keeping", 1, ["config.get", "config.patch", "sessions.usage"]),
];
