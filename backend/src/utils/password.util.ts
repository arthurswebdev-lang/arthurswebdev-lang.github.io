import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

/**
 * Passwords are stored as a scrypt hash with a per-user salt.
 *
 * The scheme is deliberately simple — this API authenticates one person with a
 * username and password sent in a header — but storing the password itself
 * would mean a database leak hands over the password too, and that costs
 * nothing to avoid.
 */
export function newSalt(): string {
  return randomBytes(SALT_BYTES).toString('hex');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await scryptAsync(password, salt, KEY_LENGTH) as Buffer;

  return derived.toString('hex');
}

/** Constant-time comparison, so a wrong password cannot be timed character by character. */
export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const actual = Buffer.from(await hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
