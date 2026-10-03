// Product/package naming constants that bridge current Branch Agent manifests with
// legacy Clawdbot keys still seen in older configs and packages.
export const MANIFEST_KEY = "branch" as const;

/** Manifest keys accepted only for legacy compatibility. */
export const LEGACY_MANIFEST_KEYS = ["clawdbot"] as const;
