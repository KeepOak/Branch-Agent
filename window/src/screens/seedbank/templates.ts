// The eight day-one Trunk templates (owner item 39b, board cards #786–#793), Official "by Branch". They ship with the app,
// so Seedbank › Agents and onboarding step 4 (R1-07) list them even when the catalog is offline. Adding one runs
// trunks.template.create with the engine's bundled template id. trunks.template.list says which ones this engine carries;
// a template it doesn't carry yet shows Coming. The old six (Inbox Manager, Expense Manager, Researcher, Chief of Staff,
// Bug Reproduction, Trip Planner) are not day-one templates.

export type DayOneTemplate = {
  /** The bundled template id: engine/skills/trunk-templates/<id>.branch.trunk-template.json. */
  id: string;
  name: string;
  description: string;
  /** The face colour from the approved preview. */
  colour: string;
  /** Other ids the engine may ship it under. */
  aliases?: readonly string[];
};

export const DAY_ONE_TEMPLATES: readonly DayOneTemplate[] = [
  { id: "trunk-doctor", name: "Trunk Doctor", description: "Builds new Trunks from a short interview, then gives your team a weekly checkup", colour: "#56616B" },
  { id: "mentions-watch", name: "Mentions Watch", description: "Watches the web for mentions of you or your brand and sends a quiet weekday digest. Never posts", colour: "#B07A2A", aliases: ["mention-monitor"] },
  { id: "home-desk", name: "Home Desk", description: "Family and home admin on your email and calendar, with a printable morning page. Never sends without you", colour: "#8A6A4A" },
  { id: "project-lead", name: "Project Lead", description: "Runs projects as topics in a group and hands each task to the right Trunk", colour: "#4F6FA8" },
  { id: "prospect-finder", name: "Prospect Finder", description: "Researches prospects that fit and drafts first messages for you to approve", colour: "#C9A227" },
  { id: "search-brief-desk", name: "Search Brief Desk", description: "Turns keywords into content ideas and writer-ready briefs for Google and AI answers", colour: "#2F5E9E" },
  { id: "spend-saver", name: "Spend Saver", description: "Finds subscription savings in your bills and drafts the counteroffers", colour: "#2F8C86" },
  { id: "hiring-desk", name: "Hiring Desk", description: "Schedules interview loops, preps interviewers and chases feedback", colour: "#8A5AA8" },
];

/** One template as trunks.template.list returns it. */
export type ListedTemplate = { id: string; name: string; description: string; permissions: string[] };

const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The engine's copy of a day-one template, matched by id, alias or name; undefined when this engine doesn't ship it. */
export function listedTemplate(template: DayOneTemplate, listed: readonly ListedTemplate[]): ListedTemplate | undefined {
  const ids = new Set([template.id, ...(template.aliases ?? [])].map(key));
  return listed.find(item => ids.has(key(item.id))) ?? listed.find(item => key(item.name) === key(template.name));
}

/** Reads trunks.template.list ({templates}) defensively: a missing or mistyped field reads as empty. */
export function readListedTemplates(result: unknown): ListedTemplate[] {
  const items = result && typeof result === "object" ? (result as { templates?: unknown }).templates : undefined;
  if (!Array.isArray(items)) return [];
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return items.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const t = item as Record<string, unknown>;
    if (!text(t.id)) return [];
    return [{ id: text(t.id), name: text(t.name) || text(t.id), description: text(t.description), permissions: Array.isArray(t.permissions) ? t.permissions.filter((p): p is string => typeof p === "string") : [] }];
  });
}
