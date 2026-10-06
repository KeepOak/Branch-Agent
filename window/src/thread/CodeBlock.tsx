import { useMemo, useState } from "react";
import { copyText, useThread } from "./context";
import { highlight } from "./highlight";
import { Icon, ICONS } from "./icons";
import { JsonCodeView } from "./JsonCodeView";
import { parseJsonCode } from "./json-code-view";

/** Lines shown before "Show <n> more lines" (§4.2.2 Parity adds "Code block"). */
export const CODE_PREVIEW_LINES = 7;

const LANGS: Record<string, string> = {
  sh: "Shell", bash: "Shell", shell: "Shell", zsh: "Shell", powershell: "PowerShell", ps1: "PowerShell",
  cpp: "C++", "c++": "C++", css: "CSS", diff: "Diff", go: "Go", java: "Java", js: "JavaScript",
  javascript: "JavaScript", json: "JSON", md: "Markdown", markdown: "Markdown", py: "Python", python: "Python",
  rs: "Rust", rust: "Rust", ts: "TypeScript", typescript: "TypeScript", tsx: "TypeScript", xml: "XML",
  html: "HTML", yaml: "YAML", yml: "YAML",
};

/** A code block in a reply: its language, Copy, Wrap lines, and long blocks folded to 7 lines. */
export function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const { toast, prefs } = useThread();
  const colours = prefs?.codeCol === "tm" ? "theme" : prefs?.codeCol ?? "theme";
  const [wrap, setWrap] = useState(false);
  const [all, setAll] = useState(false);
  const [raw, setRaw] = useState(false);
  const isJson = lang.toLowerCase() === "json";
  const json = useMemo(() => isJson ? parseJsonCode(text) : null, [isJson, text]);
  const tree = !!json?.root && !raw;
  const lines = text.split("\n");
  const hidden = lines.length - CODE_PREVIEW_LINES;
  const shown = all || hidden <= 0 ? text : lines.slice(0, CODE_PREVIEW_LINES).join("\n");
  return (
    <div className="code-block" data-testid="code-block" data-colours={colours}>
      <div className="code-head">
        <span className={isJson ? "json-code-language" : undefined}>{LANGS[lang.toLowerCase()] ?? (lang || "Code")}</span>
        {isJson && <div className="json-code-modes" role="group" aria-label="Show the JSON as">
          <button type="button" aria-pressed={tree} disabled={!json?.root} title={!json?.root ? "This JSON is shown as Raw." : undefined} onClick={() => setRaw(false)}>Tree</button>
          <button type="button" aria-pressed={!tree} onClick={() => setRaw(true)}>Raw</button>
        </div>}
        <button type="button" className="icon-sm" aria-label="Copy" title="Copy" onClick={() => void copyText(text, toast)}>
          <Icon d={ICONS.copy} />
        </button>
        <button
          type="button"
          className="icon-sm"
          hidden={tree}
          aria-pressed={wrap}
          aria-label={wrap ? "Don't wrap lines" : "Wrap lines"}
          title={wrap ? "Don't wrap lines" : "Wrap lines"}
          onClick={() => setWrap((v) => !v)}
        >
          <Icon d={ICONS.wrap} />
        </button>
      </div>
      {json?.root && <div hidden={!tree}><JsonCodeView json={json} /></div>}
      <pre hidden={tree} className={wrap ? "wrap" : undefined}>
        <Code text={shown} lang={lang} />
      </pre>
      {hidden > 0 ? (
        <button type="button" className="link-btn" hidden={tree} onClick={() => setAll((v) => !v)}>
          {all ? "Show less" : hidden === 1 ? "Show 1 more line" : `Show ${hidden} more lines`}
        </button>
      ) : null}
    </div>
  );
}

function Code({ text, lang }: { text: string; lang: string }) {
  const html = highlight(text, lang);
  return html === null ? <code>{text}</code> : <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />;
}
