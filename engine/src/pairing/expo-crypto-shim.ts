// Engine stand-in for expo-crypto when the hop test bundles PhoneGateway.
// The phone's relayFrames does not import this file; it is only an alias if
// some other mobile module in that graph asks for Expo's RNG.
import { randomBytes, randomUUID as nodeRandomUUID } from "node:crypto";

export function getRandomBytes(count: number): Uint8Array {
  return new Uint8Array(randomBytes(count));
}

export function getRandomValues<T extends Uint8Array>(typedArray: T): T {
  typedArray.set(randomBytes(typedArray.length));
  return typedArray;
}

export function randomUUID(): string {
  return nodeRandomUUID();
}
