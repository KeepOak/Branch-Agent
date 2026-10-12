// Default approval categories (atlas SAFETY-0215): what runs without asking, what always asks, what is handed
// to the owner, and why Full access never ships on. Owner on Full access is asked nothing outside the floor
// and the owner's own named rules (page 03 rule 6).

export type ApprovalCategory =
  | "read-documents"
  | "browse"
  | "record-task"
  | "send-message"
  | "delete-many"
  | "delete"
  | "spend"
  | "purchase"
  | "post"
  | "install"
  | "screen-control"
  | "first-open"
  | "sign-in"
  | "self-modify"
  | "camera-mic-location"
  | "download"
  | "extension-install"
  | "password-change"
  | "captcha"
  | "security-warning";

export type CategoryDefault = "without-asking" | "asks" | "hand-off";

/** Shipped defaults. "asks" means every time; "hand-off" means the owner does the step themselves. */
export const DEFAULT_APPROVAL_CATEGORIES: Readonly<Record<ApprovalCategory, CategoryDefault>> =
  Object.freeze({
    "read-documents": "without-asking",
    browse: "without-asking",
    "record-task": "without-asking",
    "send-message": "asks",
    "delete-many": "asks",
    delete: "asks",
    spend: "asks",
    purchase: "asks",
    post: "asks",
    install: "asks",
    "screen-control": "asks",
    "first-open": "asks",
    "sign-in": "asks",
    "self-modify": "asks",
    "camera-mic-location": "asks",
    download: "asks",
    "extension-install": "asks",
    "password-change": "hand-off",
    captcha: "hand-off",
    "security-warning": "hand-off",
  });

/** Default per-task spending cap on pay-per-use accounts, in US dollars. */
export const DEFAULT_SPEND_CAP_USD_PER_TASK = 2;

/** Full access is the system permission only the person can grant; it is never shipped on. */
export const FULL_ACCESS_SHIPPED_ON = false;
export const FULL_ACCESS_SETUP_LINE = "Full access stays off until you turn it on yourself.";

export type CategoryCaller = {
  /** The owner in the window or the owner's verified direct chat. */
  owner: boolean;
  /** Only meaningful for the owner; anyone else never has Full access. */
  fullAccess: boolean;
};

export type CategoryDecision =
  | { outcome: "allow" }
  | { outcome: "ask"; why: string }
  | { outcome: "hand-off"; why: string }
  | { outcome: "deny"; why: string };

function spendDecision(spendUsd: number, spentSoFarUsd: number, capUsd: number): CategoryDecision {
  if (spentSoFarUsd + spendUsd > capUsd) {
    return { outcome: "deny", why: `over the $${capUsd} per-task spending cap` };
  }
  return { outcome: "ask", why: "it spends money" };
}

/** Resolve one action's category under the shipped defaults. `floor` holds the owner's named always-ask rules. */
export function resolveCategoryDecision(params: {
  category: ApprovalCategory;
  caller: CategoryCaller;
  floor?: ReadonlySet<ApprovalCategory>;
  spendUsd?: number;
  spentSoFarUsd?: number;
  capUsd?: number;
}): CategoryDecision {
  const { category, caller } = params;
  if (caller.owner && caller.fullAccess && !params.floor?.has(category)) {
    return { outcome: "allow" };
  }
  const shipped = DEFAULT_APPROVAL_CATEGORIES[category];
  if (shipped === "without-asking") {
    return { outcome: "allow" };
  }
  if (shipped === "hand-off") {
    return { outcome: "hand-off", why: "only you can do this step" };
  }
  if (category === "spend" || category === "purchase") {
    const cap = params.capUsd ?? DEFAULT_SPEND_CAP_USD_PER_TASK;
    return spendDecision(params.spendUsd ?? 0, params.spentSoFarUsd ?? 0, cap);
  }
  return { outcome: "ask", why: "it acts on the world" };
}

export type FeatureTrait =
  | "spends-money"
  | "sends-data-out"
  | "deletes"
  | "mic-or-camera"
  | "heavy-resources"
  | "loosens-safety";

/** Features ship on unless they spend, send data out on their own, delete, use mic/camera, run heavy or loosen safety. */
export function isFeatureShippedOn(traits: readonly FeatureTrait[]): boolean {
  return traits.length === 0;
}

/** Each bot keeps its own credentials: returns every credential reference shared by more than one bot. */
export function findSharedBotCredentials(
  bots: ReadonlyArray<{ id: string; credentialRef: string }>,
): string[] {
  const owners = new Map<string, Set<string>>();
  for (const bot of bots) {
    const set = owners.get(bot.credentialRef) ?? new Set<string>();
    set.add(bot.id);
    owners.set(bot.credentialRef, set);
  }
  return [...owners].filter(([, ids]) => ids.size > 1).map(([ref]) => ref);
}

/** The question the person sees: what, which Trunk, which computer, which account. Nothing goes out without it. */
export function describeApprovalRequest(params: {
  action: string;
  trunk: string;
  computer: string;
  account?: string;
}): string {
  const account = params.account ? `, as ${params.account}` : "";
  return `${params.trunk} wants to ${params.action} on ${params.computer}${account}. Allow?`;
}
