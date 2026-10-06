/** The only config write admitted while locked is the explicit switch itself. */
export function isLockdownSwitchPatch(params: unknown): boolean {
  if (!params || typeof params !== "object") return false;
  const raw = (params as { raw?: unknown }).raw;
  if (typeof raw !== "string") return false;
  try {
    const patch = JSON.parse(raw) as unknown;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
    const root = patch as Record<string, unknown>;
    if (Object.keys(root).length !== 1 || !root.security || typeof root.security !== "object" || Array.isArray(root.security)) return false;
    const security = root.security as Record<string, unknown>;
    return Object.keys(security).length === 1 && typeof security.lockdown === "boolean";
  } catch {
    return false;
  }
}
