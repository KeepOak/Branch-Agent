import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { blake2b512 } from "./blake2b.ts";

test("pure BLAKE2b-512 matches the RFC 7693 'abc' vector", () => {
  assert.equal(
    blake2b512(Buffer.from("abc")).toString("hex"),
    "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923",
  );
});

test("pure BLAKE2b-512 matches OpenSSL across block boundaries", () => {
  for (const n of [0, 1, 127, 128, 129, 255, 256, 257, 1000, 1 << 20]) {
    const data = randomBytes(n);
    assert.equal(blake2b512(data).toString("hex"), createHash("blake2b512").update(data).digest("hex"), `length ${n}`);
  }
});

test("hashed minisign round-trips without node:crypto BLAKE2b (Electron/BoringSSL-safe)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const payload = randomBytes(4096);
  const sig = sign(null, blake2b512(payload), privateKey);
  assert.ok(verify(null, blake2b512(payload), publicKey, sig));
  assert.ok(!verify(null, blake2b512(Buffer.concat([payload, Buffer.from("x")])), publicKey, sig));
});

test("no desktop source calls node:crypto BLAKE2b (#2104: Electron throws 'Digest method not supported')", () => {
  const offenders = readdirSync(import.meta.dirname)
    .filter((f) => /\.(ts|mts|cts|js|mjs)$/.test(f) && !f.endsWith(".test.ts"))
    .filter((f) => /create(Hash|Hmac)\(\s*["'`]blake2/i.test(readFileSync(join(import.meta.dirname, f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("update-signature hashes through the Electron-safe digest helper", () => {
  const src = readFileSync(join(import.meta.dirname, "update-signature.ts"), "utf8");
  assert.doesNotMatch(src, /createHash\(/);
  assert.match(src, /digest\("blake2b512"/);
});
