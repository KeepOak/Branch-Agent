import { canopyHost } from "../../host.ts";

export function normalizeSessionKeyForUiComparison(sessionKey: string): string {
  return canopyHost().sessions.normalizeKey(sessionKey);
}
