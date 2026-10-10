/** Friendly labels; filenames remain available as tooltips for advanced users. */
export const FILE_TITLES: Record<string, string> = {
  "SOUL.md": "Personality", "IDENTITY.md": "Name", "USER.md": "About you",
  "AGENTS.md": "House rules", "TOOLS.md": "Tools", "SOP.md": "Standing steps",
  "MEMORY.md": "Memory", "HEARTBEAT.md": "Scheduled check-ins", "BOOTSTRAP.md": "First-run steps",
};
export const fileTitle = (name: string) => FILE_TITLES[name] ?? "Instructions";
