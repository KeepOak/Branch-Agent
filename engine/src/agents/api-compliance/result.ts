// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/api_compliance/result.py (atlas AGENT-LOOP-0094). Converted to strict TypeScript; uses the native OpenAI-compatible diagnostic transport.
export type APIResponse = "accepted" | "rejected" | "timeout" | "connection_error";
export interface ComplianceTestResult {
  pattern_name: string;
  model: string;
  model_id: string;
  provider: string;
  response_type: APIResponse;
  error_message: string | null;
  error_type: string | null;
  http_status: number | null;
  raw_response: unknown;
  notes: string | null;
}
export interface PatternResults {
  pattern_name: string;
  pattern_description: string;
  results: ComplianceTestResult[];
}
export interface ComplianceReport {
  test_run_id: string;
  timestamp: string;
  elapsed_time: number;
  patterns_tested: number;
  models_tested: string[];
  results: PatternResults[];
}
export function reportCounts(report: ComplianceReport) {
  const results = report.results.flatMap((pattern) => pattern.results);
  return {
    total_tests: results.length,
    total_rejected: results.filter((r) => r.response_type === "rejected").length,
    total_accepted: results.filter((r) => r.response_type === "accepted").length,
  };
}
