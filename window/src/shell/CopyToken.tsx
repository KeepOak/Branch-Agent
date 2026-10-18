// A long single token (a setup code, a link, a path, an id) on one line: it ends in an ellipsis where it would run
// past its box, its full value stays in the title, and Copy puts all of it on the clipboard (Private #1103 item 2).
// Copy says so twice: the button reads "Copied" for a moment and the window's toast says "Copied." (§4.2.6).
import { useEffect, useState } from "react";
import { copyText } from "../thread/context";
import { notify } from "./notify";
import "./copy-token.css";

type Props = { value: string; label?: string; strong?: boolean; toast?: (text: string) => void; testid?: string };

export const COPIED_MS = 2000;

export function CopyToken({ value, label = "Copy", strong, toast = notify, testid }: Props) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    let ok = true;
    await copyText(value, (text) => { ok = text === "Copied."; toast(text); });
    setCopied(ok);
  };
  return <span className={strong ? "copy-token strong" : "copy-token"} data-testid={testid}>
    <code className="copy-token-text" title={value}>{value}</code>
    <button type="button" className="copy-token-btn" data-local="" aria-label={copied ? "Copied" : `${label}: ${value}`} onClick={() => void copy()}>{copied ? "Copied" : label}</button>
  </span>;
}
