/** Short visual match for the same pending device request on both Branches. */
export function pairingCheckCode(requestId: string): string {
  return requestId.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
}
