import type { WindowEngine } from "../../connect/engine";
import { errorText, type FileEntry } from "../library/data";
import { createReadyTrunk } from "../trunk/api";
export const JOBS = [
  { name: "Inbox Manager", description: "Clears your inbox and drafts replies in your voice" },
  { name: "Expense Manager", description: "Files receipts and builds monthly reports" },
  { name: "Researcher", description: "Reads the web and writes short briefs with sources" },
  { name: "Chief of Staff", description: "Plans your week and chases loose ends" },
  { name: "Bug Reproduction", description: "Turns a bug report into exact steps" },
  { name: "Trip Planner", description: "Finds and books refundable travel" },
];
/** Create an actual Trunk, then append the selected job to its source-generated instructions. */
export async function createJob(engine: WindowEngine, job: typeof JOBS[number], current: () => boolean = () => true) {
  const agentId = await createReadyTrunk(engine, job.name, current);
  try {
    if (!current()) throw new Error("You left this screen before its job instructions were saved.");
    const { file } = await engine.request<{ file: FileEntry }>("agents.files.get", { agentId, name: "SOUL.md" });
    if (!current()) throw new Error("You left this screen before its job instructions were saved.");
    if (!file.missing && !file.hash) throw new Error("The engine did not supply a file version for a safe edit.");
    const content = (file.content ?? "").trimEnd() + "\n\n## Your job\n\n" + job.description + ".\n";
    const saved = await engine.request<{ ok: boolean }>("agents.files.set", { agentId, name: "SOUL.md", content, ...(file.missing ? { expectedMissing: true } : { expectedHash: file.hash }) });
    if (saved.ok !== true) throw new Error("The engine did not confirm the instructions were saved.");
    return agentId;
  } catch (error) { throw new Error(`${job.name} was created (${agentId}), but its job instructions were not saved. ${errorText(error)} Open Edit to finish setting it up.`); }
}
