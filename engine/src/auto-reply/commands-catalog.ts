/** Pure parsing and rendering for read-only slash command catalogues. */
import type { SkillCommandSpec } from "../skills/types.js";

export const SLASH_CATALOG_PAGE_SIZE = 8;

export type CatalogRequest =
  | { page: number; paginated: boolean; usage?: never }
  | { usage: string; page?: never; paginated?: never };

/** Accept only an exact command token; unrelated prefixes keep normal routing. */
export function parseCatalogRequest(
  body: string,
  command: "commands" | "skills",
): CatalogRequest | null {
  const tokens = body.trim().split(/\s+/u);
  if (tokens.shift() !== `/${command}`) {
    return null;
  }
  const paginated = tokens.length > 0 || command === "skills";
  if (tokens[0] === "list") {
    tokens.shift();
  }
  if (tokens.length === 0) {
    return { page: 1, paginated };
  }
  const rawPage = tokens[0] ?? "";
  const page = Number(rawPage);
  if (tokens.length !== 1 || !/^[1-9]\d*$/u.test(rawPage) || !Number.isSafeInteger(page)) {
    return { usage: `Usage: /${command} [list] [page] (page must be a positive integer)` };
  }
  return { page, paginated: true };
}

/** Render the supplied authorized inventory, preserving its discovery order. */
export function buildSkillsCatalogPage(skills: readonly SkillCommandSpec[], page = 1) {
  const totalPages = Math.max(1, Math.ceil(skills.length / SLASH_CATALOG_PAGE_SIZE));
  const currentPage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, totalPages) : 1;
  const selected = skills.slice(
    (currentPage - 1) * SLASH_CATALOG_PAGE_SIZE,
    currentPage * SLASH_CATALOG_PAGE_SIZE,
  );
  const lines = [`Available skills (${currentPage}/${totalPages})`, ""];
  if (selected.length === 0) {
    lines.push("No skills available for this agent.");
  } else {
    for (const skill of selected) {
      lines.push(`${skill.skillName || skill.name} — ${skill.description}`);
      lines.push(`  /skill ${skill.name} [input]`);
    }
  }
  if (totalPages > 1) {
    lines.push("", "More: /skills [page]");
  }
  return { text: lines.join("\n"), currentPage, totalPages };
}
