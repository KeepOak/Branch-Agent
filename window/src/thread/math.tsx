// Maths in replies (Settings › Appearance › "Show maths as formulas"): TeX between $…$, \(…\), $$…$$ or \[…\] is
// typeset with KaTeX, loaded only when a reply has maths. KaTeX escapes the TeX and runs no HTML (trust off), so
// its markup is safe to place. With the setting off, or while KaTeX loads, the TeX shows as written.
import { useEffect, useState } from "react";

type Katex = { renderToString: (tex: string, options: Record<string, unknown>) => string };
let loaded: Katex | null = null;
let loading: Promise<Katex> | null = null;

function loadKatex(): Promise<Katex> {
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => (loaded = (m.default ?? m) as Katex));
  return loading;
}

export function MathTex({ tex, display, raw }: { tex: string; display: boolean; raw: string }) {
  const [katex, setKatex] = useState<Katex | null>(loaded);
  useEffect(() => {
    if (!katex) void loadKatex().then(setKatex, () => undefined);
  }, [katex]);
  if (!katex) return <code className="md-tex">{raw}</code>;
  let html: string;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore" });
  } catch {
    return <code className="md-tex">{raw}</code>;
  }
  return display ? <div className="md-math" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="md-math-i" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Inline maths: $…$ (not "$5 and $6"), or \(…\). */
export const INLINE_MATH = /(\$[^\s$](?:[^$\n]*[^\s$])?\$(?!\d)|\\([^\n]+?\\))/;

export function readInlineMath(part: string): string | null {
  if (part.startsWith("\(")) return part.slice(2, -2);
  if (part.startsWith("$") && part.endsWith("$") && part.length > 2) return part.slice(1, -1);
  return null;
}
