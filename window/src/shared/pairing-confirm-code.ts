/** Alphabet for the 6-character pairing confirm code. Skips I, L, O and U. */
export const PAIRING_CONFIRM_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Short visual match for the same pairing session on the computer and the phone.
 * Copied from engine/src/pairing/confirm-code.ts so the window does not import
 * Node pairing modules. pairing-confirm-code.test.ts checks the two agree.
 */
export function pairingConfirmCode(seed: string): string {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  let bits = hash >>> 0;
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += PAIRING_CONFIRM_ALPHABET[bits % PAIRING_CONFIRM_ALPHABET.length];
    bits = (Math.imul(bits, 1664525) + 1013904223) >>> 0;
  }
  return code;
}
