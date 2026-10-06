/** The host-attach ladder ported from Hermes' gateway/host_attach.py. */
export type HostGateway = {
  pid: number;
  home: string;
  port: number;
  profiles: readonly string[];
  servedKnown: boolean;
  standalone: boolean;
};

export type HostAttachDecision = {
  outcome: "start" | "attach" | "replace-host" | "refuse";
  message: string;
  owner?: HostGateway;
  transient?: boolean;
};

export function hostServesProfile(owner: HostGateway, profile: string): boolean {
  return (
    owner.servedKnown &&
    owner.profiles.some((served) => served.trim().toLowerCase() === profile.trim().toLowerCase())
  );
}

/** Unknown served sets are transient, never evidence that a second gateway is safe. */
export async function decideHostAttach(params: {
  profile: string;
  owner?: HostGateway;
  replace?: boolean;
  waitForOwner?: () => Promise<HostGateway | undefined>;
  rescan?: (owner: HostGateway) => Promise<HostGateway | undefined>;
}): Promise<HostAttachDecision> {
  let owner = params.owner;
  if (!owner) {
    return { outcome: "start", message: "" };
  }
  if (params.replace && (hostServesProfile(owner, params.profile) || !owner.servedKnown)) {
    return { outcome: "replace-host", message: "", owner };
  }
  if (hostServesProfile(owner, params.profile)) {
    return {
      outcome: "attach",
      message: `The host gateway already serves profile '${params.profile}' (PID ${owner.pid}, port ${owner.port}).`,
      owner,
      transient: true,
    };
  }
  if (!owner.servedKnown && params.waitForOwner) {
    owner = await params.waitForOwner();
    if (!owner) {
      return { outcome: "start", message: "" };
    }
    if (hostServesProfile(owner, params.profile)) {
      return {
        outcome: "attach",
        message: `The host gateway already serves profile '${params.profile}' (PID ${owner.pid}, port ${owner.port}).`,
        owner,
        transient: true,
      };
    }
  }
  const rescanned = await params.rescan?.(owner);
  if (rescanned && hostServesProfile(rescanned, params.profile)) {
    return {
      outcome: "attach",
      message: `The host gateway now serves profile '${params.profile}' (PID ${rescanned.pid}, port ${rescanned.port}).`,
      owner: rescanned,
      transient: true,
    };
  }
  if (rescanned?.standalone) {
    return { outcome: "start", message: "" };
  }
  if (!owner.servedKnown) {
    return {
      outcome: "refuse",
      message: `A gateway owns this host (PID ${owner.pid}), but has not published its served profiles yet. Retry shortly; no second gateway was started.`,
      owner,
      transient: true,
    };
  }
  return {
    outcome: "refuse",
    message: `A gateway owns this host (PID ${owner.pid}) and does not serve profile '${params.profile}'. No second gateway was started.`,
    owner,
  };
}
