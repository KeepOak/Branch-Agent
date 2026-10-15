// Settings › Computer & browser, Build folders: the one line the last build worktree cleanup reported
// (buildWorktrees.status), e.g. "Freed 6.2 GB, removed 5 worktrees · today 4:10 PM".
import type { SettingsPageProps } from "../index";
import { Sec } from "../kit";
import { rec, str, useLive, when, type RecordValue } from "./common";
import "./computer-cleanup.css";

const HINT = "Branch removes finished build copies by itself: only clean, fully pushed ones whose work is merged, whose branch is gone, or that sat untouched for two days.";

/** Hidden where the engine has no build cleanup (older engines) or it is turned off. */
export function BuildCleanup({ engine }: Pick<SettingsPageProps, "engine">) {
  const res = useLive<RecordValue>(engine, "buildWorktrees.status", {}, []);
  const data = rec(res.data);
  if (res.error || data.enabled !== true) return null;
  const last = rec(data.last);
  const line = str(last.line);
  const at = when(last.at);
  const text = line
    ? `${line.charAt(0).toUpperCase()}${line.slice(1)}${at ? ` · ${at}` : ""}`
    : "Nothing to clean up yet. Branch checks every 30 minutes and after each merge.";
  return (
    <Sec title="Build folders" hint={HINT} id="s2-build-cleanup">
      <p className="s2-build-line" data-row="Build folder cleanup">{text}</p>
    </Sec>
  );
}
