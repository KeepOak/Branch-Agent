// Ported from bytedance/deer-flow f840e843, skills/review/resource_graph.py.
type Link = { start: number; end: number; target: string };

function quotedTitleEnd(content: string, terminator: number): number {
  let quote = terminator;
  while (quote < content.length && /\s/u.test(content[quote] ?? "")) {
    quote += 1;
  }
  if (content[quote] !== '"') {
    return -1;
  }
  const closing = content.indexOf('"', quote + 1);
  return closing >= 0 && content[closing + 1] === ")" ? closing + 2 : -1;
}

function scanLinks(content: string): Link[] {
  const links: Link[] = [];
  let position = 0;
  while (position < content.length) {
    const opener = content.indexOf("[", position);
    const closer = content.indexOf("]", opener + 1);
    if (opener < 0 || closer < 0) {
      break;
    }
    if (content[closer + 1] !== "(") {
      position = closer + 1;
      continue;
    }
    const target = closer + 2;
    let terminator = target;
    while (
      terminator < content.length &&
      content[terminator] !== ")" &&
      !/\s/u.test(content[terminator] ?? "")
    ) {
      terminator += 1;
    }
    if (terminator === target) {
      position = target;
      continue;
    }
    const end = content[terminator] === ")" ? terminator + 1 : quotedTitleEnd(content, terminator);
    if (end < 0) {
      position = content.lastIndexOf("]", terminator - 1) + 1;
      continue;
    }
    links.push({
      start: content[opener - 1] === "!" ? opener - 1 : opener,
      end,
      target: (content.slice(target, terminator).split("#")[0] ?? "").replace(/[.?!]+$/u, ""),
    });
    position = end;
  }
  return links;
}

export function extractSkillReferences(content: string): Set<string> {
  const links = scanLinks(content);
  const refs = new Set(links.map((link) => link.target));
  const parts: string[] = [];
  let cursor = 0;
  for (const link of links) {
    parts.push(content.slice(cursor, link.start), " ".repeat(link.end - link.start));
    cursor = link.end;
  }
  parts.push(content.slice(cursor));
  const residual = parts.join("");
  for (const match of residual.matchAll(/`([^`]+)`/gu)) {
    const token = match[1]?.trim();
    if (token?.includes("/")) {
      refs.add(token.replace(/[.?!]+$/u, ""));
    }
  }
  for (const match of residual.matchAll(
    /(?<![\w./-])(?:references|scripts|templates|assets|evals)\/[A-Za-z0-9._~/%+#-]+/gu,
  )) {
    refs.add(match[0].replace(/[.?!]+$/u, ""));
  }
  return refs;
}
