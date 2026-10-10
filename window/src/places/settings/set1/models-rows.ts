// Settings › Models rows for the settings search (§4.7.0): exact titles, their section and level.
import type { RowEntry } from "../kit";

const rows = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "models", title, sec, group: sec.startsWith("Per connection") ? "Per account" : sec.replace(/, (more|technical|in depth)$/, ""), lv }));

export const MODELS_ROWS: RowEntry[] = [
  ...rows("Defaults", 0, ["Reading pictures", "Everyday answers", "Planning and hard problems", "Quick and cheap jobs", "Summaries", "If the model fails"]),
  ...rows("Second opinion", 0, ["Ask a second model on hard questions"]),
  ...rows("Media", 0, ["Make pictures", "Make short videos"]),
  ...rows("Any model, more", 1, ["Add pictures and tools to any model"]),
  ...rows("Budgets", 1, ["Most steps in one task", "Spend cap per task", "Sub-tasks at once", "Helpers may start their own helpers", "Trunks may reach each other’s conversations"]),
  ...rows("Models for smaller jobs", 1, ["Sub-tasks and side jobs", "Pick the model per task", "Planning model", "Mix models on hard questions", "Live summaries of long tasks", "Setup helper"]),
  ...rows("Compare models", 1, ["Model arena", "Test suites"]),
  ...rows("Mixtures and savings", 1, ["See what it saved", "Private things stay here", "Sure-or-not checks"]),
  ...rows("How Trunks work together, by default", 1, ["A Trunk may suggest a different pattern"]),
  ...rows("Decision models", 1, ["Model for decisions", "Send each message to the right Trunk", "Sort the Inbox by urgency", "Filter long lists before a Trunk reads them"]),
  ...rows("New conversations", 1, ["Start where you left off", "Fast replies"]),
  ...rows("Pictures, video and music", 1, ["Pictures with", "Video with", "Music with", "Fill out the picture prompt first", "Make pictures bigger afterwards", "Shrink pictures before sending", "Reads pictures, video and sound", "Read text in pictures with", "Turn documents into text with", "Send PDFs to the model as they are"]),
  ...rows("Finishing well", 1, ["Check the work before saying done", "A second model reviews the result", "Ask a stronger model for advice when it’s stuck", "Try several answers and keep the best", "Keep going while the plan has unticked steps", "When a goal is met"]),
  ...rows("Picking models", 1, ["Favourite models", "Model setups", "Model in Auto", "Model in Plan first", "Ask before a costly model", "Hide models that learn from what you send", "Offer newer models", "Warn about models not made for tasks", "Trunks may switch their own model", "Where models run", "Pictures go to a model that sees", "Each kind of step picks its own model"]),
  ...rows("Model jobs", 1, ["Looking at pictures", "Finding things on the screen", "Applying a plan’s edits", "Routers"]),
  ...rows("Retries and timeouts", 2, ["Retries when a service fails", "Wait for the first word", "Model rounds per step", "Tool and command timeout", "Largest tool answer kept whole"]),
  ...rows("Per connection", 2, ["Service tier", "Slow down near a rate limit", "Keep Claude’s cache warm", "Fewer rounds"]),
  ...rows("Model list, technical", 2, ["Keep the model list and prices up to date", "Model list"]),
  ...rows("Decision models, technical", 2, ["Ask the big model when it’s less sure than", "Longest list it filters at once"]),
  ...rows("Attachments", 2, ["Largest file you can attach"]),
  ...rows("Helpers, technical", 2, ["Conversations a Trunk can see", "Helpers a task may keep open", "Helper time limit", "Helpers at once in a swarm"]),
  ...rows("Model nicknames", 2, ["Add a nickname"]),
  ...rows("How turns run", 2, ["Runs the turns", "Where turns run", "Works like", "Tool calls", "Reuse answers to the exact same request"]),
  ...rows("Per connection, more", 2, ["OpenRouter picks", "Fall back on the service’s side", "Offer to go back after a reserve model", "Early access to new models", "Cheaper batch requests", "Answer the same question from a saved answer", "Show words per second", "Check a model hasn’t changed"]),
];
