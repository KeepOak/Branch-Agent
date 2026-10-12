import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

type State = { checkedAt?: number; notice?: string };
const statePath = () => path.join(resolveStateDir(), "model-upgrade-state.json");

export async function readModelUpgradeState(): Promise<State> {
  try {
    const raw = await fs.readFile(statePath(), "utf8");
    if (raw.length > 4096) return {};
    const value = JSON.parse(raw) as State;
    return { ...(typeof value.checkedAt === "number" ? { checkedAt: value.checkedAt } : {}),
      ...(typeof value.notice === "string" ? { notice: value.notice } : {}) };
  } catch { return {}; }
}

export async function writeModelUpgradeState(state: State): Promise<void> {
  const file = statePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, file);
}
