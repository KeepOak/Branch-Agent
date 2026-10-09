/**
 * Short visual match for the same pending device request on both Branches. The window's
 * pairingCheckCode (window/src/shared/pairing-check-code.ts), copied because Metro only compiles the
 * engine's packages from outside mobile/; checkCode.test.ts checks the two agree. The computer's Allow
 * dialog shows "Check code: XXXX" for the request, and the phone shows the same four characters.
 */
export function pairingCheckCode(requestId: string): string {
  return requestId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
}
