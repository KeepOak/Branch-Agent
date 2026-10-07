import { useState } from "react";
import { copyText, useThread } from "./context";
import { highlight } from "./highlight";
import { Icon, ICONS } from "./icons";

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
  const lines = text.split("\n");
  const hidden = lines.length - CODE_PREVIEW_LINES;
  const shown = all || hidden <= 0 ? text : lines.slice(0, CODE_PREVIEW_LINES).join("\n");
  return (
    <div className="code-block" data-testid="code-block" data-colours={colours}>
      <div className="code-head">
        <span>{!lang || lang.toLowerCase() === "text" ? "Code" : LANGS[lang.toLowerCase()] ?? lang}</span>
        <button type="button" className="icon-sm" aria-label="Copy" title="Copy" onClick={() => void copyText(text, toast)}>
          <Icon d={ICONS.copy} />
        </button>
        <button
          type="button"
          className="icon-sm"
          aria-pressed={wrap}
          aria-label={wrap ? "Don't wrap lines" : "Wrap lines"}
          title={wrap ? "Don't wrap lines" : "Wrap lines"}
          onClick={() => setWrap((v) => !v)}
        >
          <Icon d={ICONS.wrap} />
        </button>
      </div>
      <pre className={wrap ? "wrap" : undefined}>
        <Code text={shown} lang={lang} />
      </pre>
      {hidden > 0 ? (
        <button type="button" className="link-btn" onClick={() => setAll((v) => !v)}>
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
