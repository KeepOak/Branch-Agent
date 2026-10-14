// Settings › Models: the approved preview's sixteen cards (preview.html PG models), in order and at the preview's levels.
// Each card draws the Classic Models sections the preview maps to it (set1/models-*.tsx), plus Try early (Classic Advanced)
// and Testing models (Classic usage's test and evals), as Classic's own blocks without their Classic headings
// (models-live.tsx). Above the cards, the preview's tabs: Connections, Defaults, On this computer, Second opinion, Media.
import type { Row } from "../rows";

const block = (id: string, card: string, label: string, level: 0 | 1 | 2, calls: string[] = ["config.get", "config.patch"]): Row =>
  ({ id, page: "models", card, label, level, control: "custom", bare: true, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });

export const MODELS_ROWS: Row[] = [
  block("models.defaults.block", "Defaults and picking models", "Each connection’s default", 1, ["models.list", "config.get", "config.patch"]),
  block("models.smaller.block", "Models for smaller jobs", "Models for smaller jobs", 1),
  block("models.compare.block", "Compare models", "Compare models", 1),
  block("models.testing.block", "Testing models", "Test set", 0, []),
  block("models.mixtures.block", "Mixtures and savings", "Mixtures and savings", 1),
  block("models.decision.block", "Decision models", "Decision models", 1),
  block("models.media.block", "Pictures, video and music", "Pictures, video and music", 1),
  block("models.finishing.block", "Finishing well", "Finishing well", 1),
  block("models.budgets.block", "Budgets", "Budgets", 1),
  block("models.retries.block", "Retries and timeouts", "Retries and timeouts", 2),
  block("models.connection.block", "Per connection", "Per connection", 2),
  block("models.turns.block", "How turns run", "How turns run", 2),
  { id: "models.planned.coming", page: "models", card: "How turns are planned", label: "How turns are planned", level: 2, control: "custom",
    source: { kind: "coming", need: "engine: turn planning settings", reason: "How turns are planned comes in a later update." } },
  block("models.try.block", "Try early", "Try early", 1),
  block("models.attachments.block", "Attachments", "Attachments", 2),
  block("models.each.block", "Each model", "Each model", 2, ["models.list"]),
];
