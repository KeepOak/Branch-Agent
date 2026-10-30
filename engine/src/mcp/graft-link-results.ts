import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { graftLinkKey, type GraftLink } from "./graft-join.js";

type Result = { reply?: string; error?: string };
type Entry = { id: string; result: Result; acknowledgedAt?: number };
/** A completed local run is saved before contacting its host. Never discard an unacknowledged result. */
export class GraftLinkResults {
  private readonly target: string;
  constructor(link: GraftLink) {
    // Keyed by the joined address, so results saved before the host moved still replay after (#2100).
    const key = createHash("sha256")
      .update(JSON.stringify([graftLinkKey(link), link.joinedAt]))
      .digest("hex");
    this.target = path.join(resolveStateDir(), "graft", "results", `${key}.json`);
  }
  private read(): Entry[] {
    let text: string;
    try {
      text = fs.readFileSync(this.target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
    const rows: unknown = JSON.parse(text);
    if (
      !Array.isArray(rows) ||
      !rows.every(
        (row) =>
          row &&
          typeof row.id === "string" &&
          row.result &&
          (typeof row.result.reply === "string" || typeof row.result.error === "string") &&
          (row.acknowledgedAt === undefined || typeof row.acknowledgedAt === "number"),
      )
    ) {
      throw new Error("Invalid Graft result store; refusing to overwrite it.");
    }
    return rows as Entry[];
  }
  private write(rows: Entry[]): void {
    fs.mkdirSync(path.dirname(this.target), { recursive: true });
    const tmp = `${this.target}.${process.pid}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify(
        rows.filter(
          (row) =>
            row.acknowledgedAt === undefined ||
            Date.now() - row.acknowledgedAt < 7 * 24 * 60 * 60_000,
        ),
      ),
    );
    fs.renameSync(tmp, this.target);
  }
  pending(): Entry | undefined {
    return this.read().find((row) => row.acknowledgedAt === undefined);
  }
  get(id: string): Result | undefined {
    return this.read().find((row) => row.id === id)?.result;
  }
  save(id: string, result: Result): void {
    const rows = this.read();
    if (!rows.some((row) => row.id === id)) {
      rows.push({ id, result });
      this.write(rows);
    }
  }
  acknowledge(id: string): void {
    const rows = this.read();
    const row = rows.find((entry) => entry.id === id);
    if (row) {
      row.acknowledgedAt = Date.now();
      this.write(rows);
    }
  }
}
