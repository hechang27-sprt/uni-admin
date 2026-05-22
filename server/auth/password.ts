import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2Async = promisify(pbkdf2);
const algorithm = "pbkdf2_sha256";
const iterations = 310_000;
const keyLength = 32;
const saltLength = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const derivedKey = await pbkdf2Async(
    password,
    salt,
    iterations,
    keyLength,
    "sha256",
  );

  return [
    algorithm,
    String(iterations),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [storedAlgorithm, storedIterations, storedSalt, storedHash] =
    encodedHash.split("$");

  if (
    storedAlgorithm !== algorithm ||
    !storedIterations ||
    !storedSalt ||
    !storedHash
  ) {
    return false;
  }

  const parsedIterations = Number(storedIterations);
  if (!Number.isInteger(parsedIterations) || parsedIterations < 1) {
    return false;
  }

  const expected = Buffer.from(storedHash, "base64url");
  const actual = await pbkdf2Async(
    password,
    Buffer.from(storedSalt, "base64url"),
    parsedIterations,
    expected.length,
    "sha256",
  );

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
