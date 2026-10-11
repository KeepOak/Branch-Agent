/**
 * Standard web globals models expect in Code Mode: base64 (`atob`, `btoa`) and
 * `crypto` (`randomUUID`, `getRandomValues`). Base64 is pure guest code. The
 * random source is a host callback that returns only a hex string, so no host
 * object reaches the guest. When an executor supplies no random source,
 * `crypto` stays undefined instead of falling back to `Math.random`.
 */
export const CODE_MODE_HOST_RANDOM_HEX = "__branchHostRandomHex";

/** Largest byte count one `crypto.getRandomValues` call may fill (Web Crypto quota). */
export const CODE_MODE_RANDOM_VALUES_MAX_BYTES = 65_536;

export const CODE_MODE_WEB_GLOBALS_SOURCE = String.raw`
  const hostRandomHex = globalThis.${CODE_MODE_HOST_RANDOM_HEX};
  delete globalThis.${CODE_MODE_HOST_RANDOM_HEX};
  const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const fromCharCode = String.fromCharCode;
  const namedError = (name, message) => {
    const error = new GuestError(message);
    error.name = name;
    return error;
  };
  const requireArgument = (name, count) => {
    if (count === 0) throw new GuestTypeError(name + " requires 1 argument, but none was given.");
  };
  const webEncoding = {
    btoa(data) {
      requireArgument("btoa", arguments.length);
      const input = String(data);
      for (let index = 0; index < input.length; index++) {
        if (input.charCodeAt(index) > 255) {
          throw namedError("InvalidCharacterError", "btoa: the string contains characters outside the Latin1 range. Encode it to UTF-8 bytes first.");
        }
      }
      let result = "";
      for (let index = 0; index < input.length; index += 3) {
        const remaining = input.length - index;
        const triple =
          (input.charCodeAt(index) << 16) |
          (remaining > 1 ? input.charCodeAt(index + 1) << 8 : 0) |
          (remaining > 2 ? input.charCodeAt(index + 2) : 0);
        result +=
          base64Alphabet[(triple >> 18) & 63] +
          base64Alphabet[(triple >> 12) & 63] +
          (remaining > 1 ? base64Alphabet[(triple >> 6) & 63] : "=") +
          (remaining > 2 ? base64Alphabet[triple & 63] : "=");
      }
      return result;
    },
    atob(data) {
      requireArgument("atob", arguments.length);
      // Forgiving-base64 decode from the HTML spec.
      let input = String(data).replace(/[\t\n\f\r ]/g, "");
      if (input.length % 4 === 0) input = input.replace(/={1,2}$/, "");
      if (input.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(input)) {
        throw namedError("InvalidCharacterError", "atob: the string is not correctly encoded base64.");
      }
      let result = "";
      let buffer = 0;
      let bits = 0;
      for (let index = 0; index < input.length; index++) {
        buffer = ((buffer << 6) | base64Alphabet.indexOf(input[index])) & 0xffff;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          result += fromCharCode((buffer >> bits) & 255);
        }
      }
      return result;
    },
  };
  const integerArrayNames = new Set([
    "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "BigInt64Array", "BigUint64Array",
  ]);
  // The %TypedArray% tag getter returns undefined for anything that is not a typed array.
  const typedArrayName = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(Uint8Array.prototype),
    Symbol.toStringTag,
  ).get;
  const callTypedArrayName = (value) => typedArrayName.call(value);
  const GuestUint8Array = Uint8Array;
  const parseHexByte = (hex, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  const randomHex = (length) => {
    const hex = hostRandomHex(length);
    if (typeof hex !== "string" || hex.length !== length * 2 || !/^[0-9a-f]*$/.test(hex)) {
      throw new GuestError("crypto: the random source returned an invalid value.");
    }
    return hex;
  };
  const webCrypto = typeof hostRandomHex === "function"
    ? Object.freeze({
        getRandomValues(array) {
          if (!integerArrayNames.has(callTypedArrayName(array))) {
            throw namedError("TypeMismatchError", "crypto.getRandomValues: the argument must be an integer TypedArray such as Uint8Array.");
          }
          if (array.byteLength > ${CODE_MODE_RANDOM_VALUES_MAX_BYTES}) {
            throw namedError("QuotaExceededError", "crypto.getRandomValues: the array's byte length (" + array.byteLength + ") exceeds ${CODE_MODE_RANDOM_VALUES_MAX_BYTES}.");
          }
          const hex = randomHex(array.byteLength);
          const bytes = new GuestUint8Array(array.buffer, array.byteOffset, array.byteLength);
          for (let index = 0; index < bytes.length; index++) bytes[index] = parseHexByte(hex, index);
          return array;
        },
        randomUUID() {
          const hex = randomHex(16);
          // RFC 9562 version 4: set the version nibble and the variant bits.
          const version = ((parseHexByte(hex, 6) & 0x0f) | 0x40).toString(16);
          const variant = ((parseHexByte(hex, 8) & 0x3f) | 0x80).toString(16);
          return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + version + hex.slice(14, 16) +
            "-" + variant + hex.slice(18, 20) + "-" + hex.slice(20, 32);
        },
      })
    : undefined;
`;
