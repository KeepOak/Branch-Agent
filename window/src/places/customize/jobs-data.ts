// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../connect/engine";
import { errorText, type FileEntry } from "../library/data";
import { createReadyTrunk } from "../trunk/api";
/** The starting jobs, each with the pebble colour and shape the preview draws on its tile. */
export const JOBS = [
  { name: "Inbox Manager", description: "Clears your inbox and drafts replies in your voice" , color: "#4F6FA8", shape: "50%" },
  { name: "Expense Manager", description: "Files receipts and builds monthly reports" , color: "#1785AF", shape: "46% 54% 42% 58% / 60% 44% 56% 40%" },
  { name: "Researcher", description: "Reads the web and writes short briefs with sources" , color: "#2F8C86", shape: "58% 42% 54% 46% / 52% 56% 44% 48%" },
  { name: "Chief of Staff", description: "Plans your week and chases loose ends" , color: "#56616B", shape: "62% 38% 50% 50% / 45% 55% 45% 55%" },
  { name: "Bug Reproduction", description: "Turns a bug report into exact steps" , color: "#B84A6B", shape: "42% 58% 58% 42% / 50% 42% 58% 50%" },
  { name: "Trip Planner", description: "Finds and books refundable travel" , color: "#8A5AA8", shape: "62% 38% 50% 50% / 45% 55% 45% 55%" },
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
