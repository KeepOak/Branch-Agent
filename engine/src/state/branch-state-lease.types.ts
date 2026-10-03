export type BranchStateLeaseIdentity = { scope: string; key: string; owner: string };
export type BranchStateLeaseAcquisition =
  | { kind: "acquired"; expiresAt: number }
  | { kind: "held"; holder: { owner: string; epoch: number; expiresAt: number | null } };
