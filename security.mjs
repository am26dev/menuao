import {
  randomBytes,
  createHmac,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newSecret() {
  let bits = 0,
    value = 0,
    result = "";
  for (const b of randomBytes(20)) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 31];
    }
  }
  return result;
}
function decode(s) {
  let bits = 0,
    value = 0,
    out = [];
  for (const c of s) {
    const n = alphabet.indexOf(c);
    if (n < 0) throw Error("Invalid authenticator secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 255);
    }
  }
  return Buffer.from(out);
}
export function totp(
  secret,
  counter = Math.floor(Date.now() / 30000),
  digits = 6,
) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", decode(secret)).update(b).digest(),
    o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(
    digits,
    "0",
  );
}
export function verifyTotp(secret, code, last = -1, now = Date.now()) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const counter of [current, current - 1, current + 1])
    if (
      counter > last &&
      timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code))
    )
      return counter;
  return null;
}
export function encryptSecret(secret, key) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv),
    body = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function decryptSecret(secret, key) {
  const b = Buffer.from(secret, "base64"),
    d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return d.update(b.subarray(28)).toString("utf8") + d.final("utf8");
}
