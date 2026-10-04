import {
  REPORT_FINDINGS_DESCRIPTION,
  ReportFindingsTool,
  ReportFindingsSchema,
  ReportFindingsOutputSchema,
  type ReportFindingsParams,
  type FindingsResultDisplay,
} from "../../coding/report-findings.js";
import type { AgentToolWithMeta } from "./common.js";

// The registry is rebuilt across turns; retain Qwen's live-session report identity.
const reporters = new Map<string, ReportFindingsTool>();

export function createReportFindingsTool(
  options: { agentId?: string; sessionKey?: string } = {},
): AgentToolWithMeta<typeof ReportFindingsSchema, FindingsResultDisplay> {
  const sessionKey = options.sessionKey?.trim();
  const key = sessionKey ? JSON.stringify([options.agentId?.trim() ?? "", sessionKey]) : undefined;
  const reporter = key
    ? (reporters.get(key) ?? new ReportFindingsTool())
    : new ReportFindingsTool();
  if (key) reporters.set(key, reporter);
  return {
    name: ReportFindingsTool.Name,
    label: "Review findings",
    description: REPORT_FINDINGS_DESCRIPTION,
    catalogMode: "direct-only",
    parameters: ReportFindingsSchema,
    outputSchema: ReportFindingsOutputSchema,
    execute: async (_callId, input: ReportFindingsParams, signal) => {
      signal?.throwIfAborted();
      const report = await reporter.build(input).execute(signal);
      return {
        content: [
          { type: "text", text: report.llmContent },
          { type: "text", text: JSON.stringify(report.returnDisplay, null, 2) },
        ],
        details: report.returnDisplay,
      };
    },
  };
}
