import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;

function scryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, derived) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(derived);
      },
    );
  });
}

/**
 * scrypt password hash. The stored string is the only verifier; the
 * password itself is never written down. Parameters are fixed so a row
 * cannot ask the server to run an expensive cost.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptKey(password, salt);
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) {
    return false;
  }
  const [scheme, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (
    scheme !== 'scrypt' ||
    nRaw !== String(SCRYPT_N) ||
    rRaw !== String(SCRYPT_R) ||
    pRaw !== String(SCRYPT_P) ||
    saltRaw === undefined ||
    hashRaw === undefined
  ) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltRaw, 'base64url');
    expected = Buffer.from(hashRaw, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
    return false;
  }
  const actual = await scryptKey(password, salt);
  return timingSafeEqual(actual, expected);
}
