// Background work started from this composer (DESIGN-SPEC §4.3.2 "Run it in the background", §4.3.7 Background
// chip): each job is its own conversation made with sessions.create { message }, followed with sessions.describe.
import { useCallback, useEffect, useState } from "react";
import { errorText, list, rec, str, type WindowEngine } from "./engine";
import type { BackgroundJob } from "./DockRow";

function title(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 59)}…` : one;
}

export function useBackground(engine: WindowEngine | undefined, agentId: string | undefined) {
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);

  const refresh = useCallback(
    async (key: string) => {
      if (!engine) return;
      const row = rec(rec(await engine.request("sessions.describe", { key })).session);
      const running = row.hasActiveRun === true || list(row.activeRunIds).length > 0;
      setJobs((all) => all.map((j) => (j.key === key ? { ...j, running, step: running ? "Working on it" : j.step } : j)));
    },
    [engine],
  );

  useEffect(() => {
    if (!engine) return;
    return engine.onEvent(({ event, payload }) => {
      const p = rec(payload);
      const key = str(p.key) || str(p.sessionKey);
      if ((event === "sessions.changed" || event === "chat") && jobs.some((j) => j.key === key)) {
        refresh(key).catch((e: unknown) => console.warn("Couldn't read a background conversation:", errorText(e)));
      }
    });
  }, [engine, jobs, refresh]);

  /** Starts `text` as its own conversation in the background; returns the engine's error words, or null. */
  const start = useCallback(
    async (text: string): Promise<string | null> => {
      if (!engine) return "Not connected to the engine.";
      try {
        const result = rec(await engine.request("sessions.create", { ...(agentId ? { agentId } : {}), message: text, titleSource: text.slice(0, 1000) }));
        const key = str(result.key) || str(rec(result.session).key);
        if (!key) return "The engine made no conversation.";
        setJobs((all) => [...all, { key, title: title(text), running: true, step: "Working on it" }]);
        return result.runError ? errorText(result.runError) : null;
      } catch (error) {
        return errorText(error);
      }
    },
    [engine, agentId],
  );

  const stop = useCallback(
    async (key: string): Promise<string | null> => {
      if (!engine) return "Not connected to the engine.";
      try {
        await engine.request("sessions.abort", { key });
        setJobs((all) => all.filter((j) => j.key !== key));
        return null;
      } catch (error) {
        return errorText(error);
      }
    },
    [engine],
  );

  return { jobs, start, stop };
}
