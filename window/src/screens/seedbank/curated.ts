// R1 Seedbank shows the preview's curated catalogue, not the whole community feed (#1049, GOD 20:04Z). The engine's
// plugins.catalog.browse joins the remote ClawHub index (fetchClawHubPluginOverview / fetchClawHubPluginCatalog) with this
// computer's plugins; pluginEntries turns every item into a card. Here, at the R1 boundary only, a plugin or connector card
// stays when it is on this computer (comes with Branch or installed: the engine's local.present) or when it is one the
// preview's catalogue names: its plugin catalogue (preview.html CZP_RAW_PQ18) and its connector catalogue (MCP12). A
// curated card keeps the feed's live data (install, downloads); everything else from the feed is left out. The feed, the
// engine call and pluginEntries are unchanged, so Classic and other callers see what they did before.
import { plainLine, uniqueApps } from "../../places/customize/app-logos";
import type { Entry } from "./catalog";

/** The preview's plugin catalogue (CZP_RAW_PQ18): ids and names. */
export const CURATED_PLUGINS: readonly (readonly [string, string])[] = [
  ["memory-wiki", "Memory wiki"], ["logbook", "Logbook"], ["snapshots", "Snapshots"], ["place-lookup", "Place lookup"], ["team-reports", "Team reports"],
  ["docs-search", "Docs search"], ["brave-search", "Brave web search"], ["river-map", "River map"], ["garden-lint", "garden-lint"], ["matrix", "Matrix"],
  ["mattermost", "Mattermost"], ["irc", "IRC"], ["zulip", "Zulip"], ["nostr", "Nostr"], ["ollama", "Ollama"], ["lmstudio", "LM Studio"],
  ["openrouter", "OpenRouter"], ["vllm", "vLLM"], ["memory-lancedb", "Memory LanceDB"], ["memory-graph", "Memory graph"], ["page-reader", "Page reader"],
  ["searxng", "SearXNG search"], ["voice-call", "Voice calls"], ["local-transcribe", "Local transcription"], ["scan-reader", "Scan reader"],
  ["image-studio", "Image studio"], ["lease-check", "Lease check"], ["docker-sandbox", "Docker sandbox"], ["openshell", "OpenShell sandbox"],
  ["tailscale", "Tailscale reach"], ["webhooks", "Webhooks"], ["secret-scan", "Secret scanner"], ["blocklist", "Site blocklist"],
];

/** The preview's connector catalogue (MCP12). */
export const CURATED_CONNECTORS: readonly string[] = [
  "GitHub", "GitLab", "Linear", "Jira", "Confluence", "Asana", "Trello", "ClickUp", "Monday.com", "Notion", "Airtable", "Todoist",
  "Gmail", "Outlook", "Google Calendar", "Fastmail", "Proton Mail", "Google Drive", "OneDrive", "Dropbox", "Box", "Files on this computer", "Obsidian",
  "Slack", "Discord", "Microsoft Teams", "Telegram", "Sentry", "Vercel", "Cloudflare", "Supabase", "Postgres", "SQLite", "Docker", "Kubernetes",
  "Hugging Face", "Playwright", "Figma", "Canva", "YouTube", "Spotify", "Stripe", "Shopify", "HubSpot", "Salesforce", "QuickBooks", "Zendesk",
  "Home Assistant", "Brave Search", "Weather", "Maps", "Zapier",
];

const slug = (s: string) => s.toLowerCase().replace(/^@[^/]+\//, "").replace(/[^a-z0-9]/g, "");
const PLUGIN_KEYS = new Set(CURATED_PLUGINS.flatMap(([id, name]) => [slug(id), slug(name)]));
const CONNECTOR_KEYS = new Set(CURATED_CONNECTORS.map(slug));

/** Whether an entry belongs in R1's Seedbank. Only plugins and connectors come from the community feed. */
export function inR1Seedbank(entry: Entry): boolean {
  const s = entry.source;
  if (s.type !== "plugin") return true;
  if (s.present || entry.installed) return true;
  const keys = [entry.name, s.catalogId, s.pluginId, s.packageName].filter(Boolean).map(slug);
  const curated = entry.kind === "mcp" ? CONNECTOR_KEYS : PLUGIN_KEYS;
  return keys.some(k => curated.has(k));
}

/** A connector card per app, not per listing (A-141): the one on this computer wins, then the official one, then the most
 *  added. Its line is the summary's first sentence in plain words. Plugins pass through as they are. */
const connectorRank = (e: Entry) => (e.installed || (e.source.type === "plugin" && e.source.present) ? 1e12 : 0) + (e.badge === "Official" ? 1e11 : 0) + (e.downloads ?? 0);
export const curatedEntries = (entries: readonly Entry[]): Entry[] => {
  const kept = entries.filter(inR1Seedbank);
  const apps = new Set(uniqueApps(kept.filter(e => e.kind === "mcp"), e => e.name, connectorRank));
  return kept.flatMap(e => e.kind !== "mcp" ? [e] : apps.has(e) ? [{ ...e, desc: plainLine(e.desc) }] : []);
};
