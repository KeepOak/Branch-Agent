// Code colours in replies (Settings › Appearance › Code colours), with highlight.js and the same languages as
// OpenClaw's control UI (ui/src/components/markdown-code-blocks.ts). highlight.js escapes the code it returns.
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "./highlight.css";

const LANGS = { bash, cpp, css, diff, go, java, javascript, json, markdown, python, rust, typescript, xml, yaml };
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang);
hljs.registerAliases(["sh", "shell", "zsh", "console"], { languageName: "bash" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["c++", "c", "h"], { languageName: "cpp" });

/** The code as highlighted HTML, or null when the language isn't known (it then shows plain). */
export function highlight(text: string, lang: string): string | null {
  const name = lang.trim().toLowerCase();
  if (!name || !hljs.getLanguage(name)) return null;
  try {
    return hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
