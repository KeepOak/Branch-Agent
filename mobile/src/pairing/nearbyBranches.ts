// Nearby Branches on the r50 pairing screen. The preview lists sample computers; the phone
// has no Bonjour module yet, so Look again is real and the list is honestly empty.

export const NEARBY_NONE = 'None found. Scan the code or type it.';
export const NEARBY_LOOKING = 'Looking for your Branch. Keep this phone on the same network or Tailscale.';

export type NearbyBranch = {
  id: string;
  name: string;
  detail: string;
};

/** What the pairing screen can actually see on this phone: nothing until Bonjour lands. */
export function listNearbyBranches(): NearbyBranch[] {
  return [];
}
