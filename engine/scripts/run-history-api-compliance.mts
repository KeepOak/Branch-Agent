import path from "node:path";
// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/integration/api_compliance/run_compliance.py (atlas AGENT-LOOP-0094). Converted to TypeScript CLI for the two cited malformed-history patterns.
import { parseArgs } from "node:util";
import {
  DEFAULT_MODELS,
  PATTERNS,
  runComplianceTests,
  saveReport,
  timestamp,
} from "../src/agents/api-compliance/run-compliance.ts";
const { values } = parseArgs({
  options: {
    patterns: { type: "string" },
    models: { type: "string" },
    "output-dir": { type: "string", default: "tests/integration/api_compliance/outputs" },
    "list-patterns": { type: "boolean" },
    "list-models": { type: "boolean" },
  },
});
if (values["list-models"]) {
  for (const [id, model] of Object.entries(DEFAULT_MODELS)) console.log(`${id}: ${model.model}`);
} else if (values["list-patterns"]) {
  for (const p of PATTERNS)
    console.log(`${p.pattern_name}: ${p.pattern_description.trim().split("\n")[0]}`);
} else {
  const report = await runComplianceTests({
    patterns: values.patterns?.split(","),
    modelIds: values.models?.split(","),
  });
  const file = await saveReport(
    report,
    path.join(values["output-dir"], `run_${timestamp(new Date())}`),
  );
  console.log(`Report saved to: ${file}`);
}
