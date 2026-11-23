const MAX_BCRYPT_BYTES = 72;
const BCRYPT_COST = 10;
const encoder = new TextEncoder();

function firstBcryptBytes(plain) {
  const bytes = encoder.encode(plain);
  return bytes.length > MAX_BCRYPT_BYTES ? bytes.subarray(0, MAX_BCRYPT_BYTES) : bytes;
}

export async function hashPassword(plain) {
  if (typeof plain !== "string" || !plain) throw new TypeError("password must be a non-empty string");
  return Bun.password.hash(firstBcryptBytes(plain), { algorithm: "bcrypt", cost: BCRYPT_COST });
}

export async function verifyPassword(plain, hash) {
  if (typeof plain !== "string" || !plain || typeof hash !== "string" || !hash) return false;
  try {
    if (await Bun.password.verify(plain, hash)) return true;
    const bytes = encoder.encode(plain);
    if (bytes.length <= MAX_BCRYPT_BYTES) return false;
    return await Bun.password.verify(bytes.subarray(0, MAX_BCRYPT_BYTES), hash);
  } catch {
    return false;
  }
}
