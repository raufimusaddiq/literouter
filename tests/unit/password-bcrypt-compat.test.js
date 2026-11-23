import { describe, it, expect } from "bun:test";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "../../src/lib/auth/password.js";

const ASCII = "correct horse battery";
const UNICODE = "pässwörd-日本語-🔐";
const LONG_80 = "A".repeat(40) + "B".repeat(40);
const SPLIT_72 = "a".repeat(71) + "é" + "tail";

const HASH_2B = "$2b$10$qbes9Ashux6xDK90dF0XWuNqEDZDw033t/MSILKHSsyX5jlpoZvxy";
const HASH_2A = "$2a$10$qbes9Ashux6xDK90dF0XWuNqEDZDw033t/MSILKHSsyX5jlpoZvxy";
const HASH_UNICODE = "$2b$10$who3jjwosMQyh3rHRzRZrOjxLMOOgXPufqhjQQh18F.DS5vSSP2tO";
const HASH_LONG_80 = "$2b$10$2W6b3ZsXgf1.9z9rLr/oHu6vDWAzVFNPpfedBiImPFGwfc1Iydxay";
const HASH_SPLIT_72 = "$2b$10$SJyDRJzmdJrnYr6TCLWFGe6QVgnja/MU4692w3AMUu9KhF6T1d8Wu";
const PARITY_SEED_HASH = "$2b$10$L4mOsQ1VtXDMve3tli17K.fE2eD0VCplMb0TMTbqjW0mur9g8j0.m";

describe("password bcrypt compatibility", () => {
  it("verifies a $2b$ hash", async () => {
    expect(await verifyPassword(ASCII, HASH_2B)).toBe(true);
  });

  it("verifies a $2a$ hash", async () => {
    expect(await verifyPassword(ASCII, HASH_2A)).toBe(true);
  });

  it("verifies a unicode password", async () => {
    expect(await verifyPassword(UNICODE, HASH_UNICODE)).toBe(true);
  });

  it("verifies an 80-byte password hashed by bcryptjs", async () => {
    expect(Buffer.byteLength(LONG_80)).toBe(80);
    expect(await verifyPassword(LONG_80, HASH_LONG_80)).toBe(true);
  });

  it("verifies a password that splits a multi-byte character at byte 72", async () => {
    expect(Buffer.from(SPLIT_72).subarray(71, 73).toString("hex")).toBe("c3a9");
    expect(await verifyPassword(SPLIT_72, HASH_SPLIT_72)).toBe(true);
  });

  it("rejects a wrong password and an empty password", async () => {
    expect(await verifyPassword("wrong password", HASH_2B)).toBe(false);
    expect(await verifyPassword("", HASH_2B)).toBe(false);
    expect(await verifyPassword(ASCII, "")).toBe(false);
    expect(await verifyPassword(undefined, HASH_2B)).toBe(false);
    expect(await verifyPassword(ASCII, undefined)).toBe(false);
  });

  it("returns false (not throws) for a non-hash string", async () => {
    expect(await verifyPassword(ASCII, "not-a-bcrypt-hash")).toBe(false);
    expect(await verifyPassword(ASCII, "$2b$10$short")).toBe(false);
  });

  it("hashes made by hashPassword verify under bcryptjs.compareSync", async () => {
    const short = await hashPassword(ASCII);
    expect(bcrypt.compareSync(ASCII, short)).toBe(true);
    expect(await verifyPassword(ASCII, short)).toBe(true);

    const long = await hashPassword(LONG_80);
    expect(bcrypt.compareSync(LONG_80, long)).toBe(true);
    expect(await verifyPassword(LONG_80, long)).toBe(true);

    const split = await hashPassword(SPLIT_72);
    expect(bcrypt.compareSync(SPLIT_72, split)).toBe(true);
    expect(await verifyPassword(SPLIT_72, split)).toBe(true);
  });

  it("hashPassword emits $2b$10$", async () => {
    expect(await hashPassword(ASCII)).toMatch(/^\$2b\$10\$[./A-Za-z0-9]{53}$/);
  });

  it("the parity seed hash (password parity-pass) verifies", async () => {
    expect(await verifyPassword("parity-pass", PARITY_SEED_HASH)).toBe(true);
    expect(await verifyPassword("parity-pass-x", PARITY_SEED_HASH)).toBe(false);
  });
});
