import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  const actual = (await scrypt(password, salt!, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hex!, "hex"));
}
export function newSession() {
  return randomBytes(32).toString("hex");
}

// An operation hash must not introduce a fast offline verifier for a password.
export async function slowSecretFingerprint(
  secret: string,
  operationId: string,
): Promise<string> {
  return ((await scrypt(secret, operationId, 64)) as Buffer).toString("hex");
}

export const normalizeEmail = (email: string) => email.toLowerCase();
