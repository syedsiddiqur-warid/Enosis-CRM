// Email + password sign-in. Passwords are stored as scrypt hashes ("scrypt$N$r$p$salt$hash"), never as text.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export const MIN_PASSWORD = 10;
/** Wrong tries before the account is locked for LOCK_MINUTES */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters`;
  if (password.length > 200) return "Use at most 200 characters";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Use letters and at least one number";
  return null;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password
const DUMMY = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(KEYLEN).toString("base64")}`;

export async function verifyPassword(password: string, stored: string | null | undefined) {
  const [scheme, n, r, p, salt, hash] = (stored ?? DUMMY).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return !!stored && key.length === expected.length && timingSafeEqual(key, expected);
}

/** A readable starting password an admin can hand over (letters and digits, no look-alikes). */
export function generatePassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return /[0-9]/.test(out) ? out : `${out.slice(0, -1)}7`;
}
