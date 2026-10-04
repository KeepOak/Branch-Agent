// Formatting in replies (DESIGN-SPEC §4.2.2 Parity adds "Formatting in replies"): headings, lists and task
// lists, quotes, tables, code blocks, links, bold, italic and inline code. The text is parsed into React
// elements, so raw HTML in a reply is shown as text and never run. Streaming text re-renders block by
// block with stable keys, so what is already shown is not redrawn (rule 8).
import type { ReactNode } from "react";
import { CodeBlock } from "./CodeBlock";
import { ArtifactPreview } from "./ArtifactPreview";
import { artifactKind } from "./artifact-preview";
import { useThread } from "./context";
import { INLINE_MATH, MathTex, readInlineMath } from "./math";

export type MdBlock =
  | { type: "p"; text: string }
  | { type: "h"; level: number; text: string }
  | { type: "code"; lang: string; text: string }
  | { type: "list"; ordered: boolean; items: { text: string; task?: boolean; done?: boolean }[] }
  | { type: "quote"; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "hr" }
  | { type: "math"; tex: string; raw: string };

/** The longest reply drawn whole (Formatting in replies: "… cut short (<total> characters, …)"). */
export const MAX_REPLY_CHARS = 140_000;

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function readFence(lines: string[], i: number, out: MdBlock[]): number {
  const lang = lines[i].trim().slice(3).trim();
  const body: string[] = [];
  let j = i + 1;
  while (j < lines.length && !lines[j].trim().startsWith("```")) {
    body.push(lines[j]);
    j += 1;
  }
  out.push({ type: "code", lang, text: body.join("\n") });
  return j + 1;
}

function readList(lines: string[], i: number, out: MdBlock[]): number {
  const ordered = /^\s*\d/.test(lines[i]);
  const items: { text: string; task?: boolean; done?: boolean }[] = [];
  let j = i;
  while (j < lines.length && LIST.test(lines[j])) {
    const text = LIST.exec(lines[j])?.[2] ?? "";
    const task = TASK.exec(text);
    items.push(task ? { text: task[2], task: true, done: task[1] !== " " } : { text });
    j += 1;
  }
  out.push({ type: "list", ordered, items });
  return j;
}

function readTable(lines: string[], i: number, out: MdBlock[]): number {
  const head = splitRow(lines[i]);
  const rows: string[][] = [];
  let j = i + 2;
  while (j < lines.length && lines[j].includes("|") && lines[j].trim()) {
    rows.push(splitRow(lines[j]));
    j += 1;
  }
  out.push({ type: "table", head, rows });
  return j;
}

function readQuote(lines: string[], i: number, out: MdBlock[]): number {
  const body: string[] = [];
  let j = i;
  while (j < lines.length && lines[j].startsWith(">")) {
    body.push(lines[j].replace(/^>\s?/, ""));
    j += 1;
  }
  out.push({ type: "quote", text: body.join("\n") });
  return j;
}

/** A maths block: $$ … $$ or \[ … \], on one line or several. */
function readMath(lines: string[], i: number, out: MdBlock[]): number {
  const open = lines[i].trim().startsWith("$$") ? "$$" : "\\[";
  const close = open === "$$" ? "$$" : "\\]";
  const body: string[] = [];
  let j = i;
  let rest = lines[i].trim().slice(open.length);
  for (;;) {
    const end = rest.indexOf(close);
    if (end >= 0) {
      body.push(rest.slice(0, end));
      break;
    }
    body.push(rest);
    j += 1;
    if (j >= lines.length) break;
    rest = lines[j];
  }
  out.push({ type: "math", tex: body.join("\n").trim(), raw: lines.slice(i, j + 1).join("\n") });
  return j + 1;
}

function readParagraph(lines: string[], i: number, out: MdBlock[]): number {
  const body: string[] = [lines[i]];
  let j = i + 1;
  const starts = (l: string) => /^\s*(```|#{1,6}\s|>|---\s*$)/.test(l) || LIST.test(l);
  while (j < lines.length && lines[j].trim() && !starts(lines[j])) {
    body.push(lines[j]);
    j += 1;
  }
  out.push({ type: "p", text: body.join("\n") });
  return j;
}

/** Splits reply text into blocks. */
export function parseMarkdown(text: string): MdBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!line.trim()) i += 1;
    else if (line.trim().startsWith("```")) i = readFence(lines, i, out);
    else if (/^\s*(\$\$|\\\[)/.test(line)) i = readMath(lines, i, out);
    else if (heading) {
      out.push({ type: "h", level: heading[1].length, text: heading[2] });
      i += 1;
    } else if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push({ type: "hr" });
      i += 1;
    } else if (LIST.test(line)) i = readList(lines, i, out);
    else if (line.includes("|") && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) i = readTable(lines, i, out);
    else if (line.startsWith(">")) i = readQuote(lines, i, out);
    else i = readParagraph(lines, i, out);
  }
  return out;
}

const INLINE_BASE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const INLINE = new RegExp(`${INLINE_BASE.source.slice(0, -1)}|${INLINE_MATH.source.slice(1, -1)})`, "g");

function link(href: string, label: ReactNode, key: number): ReactNode {
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}

/** Inline formatting inside one block. */
export function inline(text: string, math = false): ReactNode[] {
  return text.split(math ? INLINE : INLINE_BASE).map((part, i) => {
    if (i % 2 === 0) return part;
    const tex = math ? readInlineMath(part) : null;
    if (tex !== null) return <MathTex key={i} tex={tex} display={false} raw={part} />;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") || part.startsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
    const md = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    return md ? link(md[2], md[1], i) : link(part, part, i);
  });
}

function Lines({ text }: { text: string }) {
  const math = useThread().prefs?.math ?? true;
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          {inline(line, math)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  );
}

function ListView({ block }: { block: Extract<MdBlock, { type: "list" }> }) {
  const items = block.items.map((item, i) => (
    <li key={i} className={item.task ? "md-task" : undefined}>
      {item.task ? <span className={item.done ? "md-box done" : "md-box"} aria-label={item.done ? "Done" : "To do"} /> : null}
      <Lines text={item.text} />
    </li>
  ));
  return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
}

function TableView({ block }: { block: Extract<MdBlock, { type: "table" }> }) {
  return (
    <div className="md-table">
      <table>
        <thead>
          <tr>{block.head.map((h, i) => <th key={i}>{inline(h)}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>{row.map((c, i) => <td key={i}>{inline(c)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MathBlock({ block }: { block: Extract<MdBlock, { type: "math" }> }) {
  const math = useThread().prefs?.math ?? true;
  return math ? <MathTex tex={block.tex} display raw={block.raw} /> : <p><Lines text={block.raw} /></p>;
}

function BlockView({ block }: { block: MdBlock }) {
  switch (block.type) {
    case "p":
      return <p><Lines text={block.text} /></p>;
    case "h":
      return <p className={`md-h md-h${Math.min(block.level, 3)}`} role="heading" aria-level={block.level}>{inline(block.text)}</p>;
    case "code":
      return artifactKind(block.lang) ? <ArtifactPreview kind={artifactKind(block.lang)!} text={block.text} /> : <CodeBlock lang={block.lang} text={block.text} />;
    case "list":
      return <ListView block={block} />;
    case "quote":
      return <blockquote><Lines text={block.text} /></blockquote>;
    case "table":
      return <TableView block={block} />;
    case "hr":
      return <hr />;
    case "math":
      return <MathBlock block={block} />;
  }
}

/** A Trunk's reply text, formatted. */
export function Markdown({ text }: { text: string }) {
  const shown = text.length > MAX_REPLY_CHARS ? text.slice(0, MAX_REPLY_CHARS) : text;
  return (
    <>
      {parseMarkdown(shown).map((block, i) => <BlockView key={i} block={block} />)}
      {shown !== text ? (
        <p className="md-cut">
          … cut short ({text.length.toLocaleString()} characters, showing the first {MAX_REPLY_CHARS.toLocaleString()}).
        </p>
      ) : null}
    </>
  );
}
