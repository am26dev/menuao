import test from "node:test";
import assert from "node:assert/strict";
import {
  totp,
  verifyTotp,
  newSecret,
  encryptSecret,
  decryptSecret,
} from "../security.mjs";
test("TOTP matches RFC 6238 SHA1 vectors and rejects replay", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  for (const [seconds, code] of [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])
    assert.equal(totp(secret, Math.floor(seconds / 30), 8), code);
  const now = 1234567890000,
    counter = Math.floor(now / 30000),
    code = totp(secret, counter);
  assert.equal(verifyTotp(secret, code, -1, now), counter);
  assert.equal(verifyTotp(secret, code, counter, now), null);
  assert.equal(verifyTotp(secret, "bad", -1, now), null);
  assert.equal(verifyTotp(secret, totp(secret, counter - 2), -1, now), null);
});
test("Authenticator secrets use authenticated encryption", () => {
  const secret = newSecret(),
    key = Buffer.alloc(32, 17),
    sealed = encryptSecret(secret, key);
  assert.equal(decryptSecret(sealed, key), secret);
  assert.ok(!sealed.includes(secret));
  const tampered = Buffer.from(sealed, "base64");
  tampered[15] ^= 1;
  assert.throws(() => decryptSecret(tampered.toString("base64"), key));
  assert.throws(() => decryptSecret(sealed, Buffer.alloc(32, 18)));
});
