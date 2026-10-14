// Overview card data for teammates made from a starter template (#463), read from trunks.template.cards.
import { number, record, records, text } from "./engine";
import { whenWord } from "./format";

export type TeammateCard = { agentId: string; name: string; summary: string; started: boolean; timezone: string; nextRunAtMs?: number; routines: number };

export function teammateCard(value: unknown): TeammateCard {
  const v = record(value);
  return {
    agentId: text(v.agentId), name: text(v.name) || text(v.title) || text(v.agentId), summary: text(v.summary),
    started: v.started === true, timezone: text(v.timezone), nextRunAtMs: number(v.nextRunAtMs), routines: records(v.routines).length,
  };
}

/** "Next run Tomorrow, 6:30 AM", "Paused until you start it", or "Runs when you message it". */
export function cardStatus(card: TeammateCard, now = new Date()): string {
  if (!card.started) return "Paused until you start it";
  if (card.nextRunAtMs !== undefined) return "Next run " + whenWord(card.nextRunAtMs, now);
  return card.routines ? "Started" : "Runs when you message it";
}
