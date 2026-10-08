import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PUSH_BACKUP_MIN_AGE_MS = 25 * 60 * 1000;

export function pushBackupShouldRelease(publishedAt, now = Date.now()) {
  if (publishedAt == null || publishedAt === "") return true;
  const published = Date.parse(publishedAt);
  if (Number.isNaN(published)) return true;
  return now - published > PUSH_BACKUP_MIN_AGE_MS;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(pushBackupShouldRelease(process.argv[2]) ? 0 : 1);
}
