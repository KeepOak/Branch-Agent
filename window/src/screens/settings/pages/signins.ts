// Settings › Sign-ins & keys: the approved preview's four cards (preview.html PG signins). Where passwords come from and the
// keys Branch holds (with their technical rows) are Classic's own blocks (set2/secrets.tsx) inside their cards; filling
// sign-ins and narrow keys wait for Branch and are Coming in their own words.
import type { Row } from "../rows";

const block = (id: string, card: string, label: string, level: 0 | 1 | 2, calls: string[]): Row =>
  ({ id, page: "signins", card, label, level, control: "custom", bare: true, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });

export const SIGNINS_ROWS: Row[] = [
  { id: "signins.fill.list", page: "signins", card: "Branch may fill", label: "Branch may fill", level: 0, control: "custom",
    source: { kind: "coming", need: "engine: the list of sign-ins Branch may fill", reason: "Branch may fill comes in a later update." } },
  block("signins.where.block", "Where passwords come from", "Password manager", 1, ["config.get", "config.patch"]),
  block("signins.keys.block", "Keys Branch holds", "Keys Branch holds", 1, ["secrets.store.list", "secrets.store.set", "secrets.store.delete", "secrets.reload"]),
  { id: "signins.narrow.make", page: "signins", card: "Narrow keys", label: "Make narrow keys for services", level: 0, control: "custom",
    help: "Vercel, Supabase and others: a key that can do only what a Trunk needs, replaced on a schedule.",
    source: { kind: "coming", need: "engine: making narrow keys with each service", reason: "Make narrow keys for services comes in a later update." } },
];
