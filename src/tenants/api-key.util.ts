import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_PATTERN = /^ffk_([A-Za-z0-9_-]{8})_[A-Za-z0-9_-]+$/;

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  hash: string;
}

// API keys are high-entropy random values, so a fast SHA-256 digest is safe
// here (unlike passwords) and keeps per-request verification cheap.
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(6).toString('base64url').slice(0, 8);
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `ffk_${prefix}_${secret}`;

  return { plaintext, prefix, hash: hashApiKey(plaintext) };
}

export function extractKeyPrefix(key: string): string | null {
  const match = KEY_PATTERN.exec(key);
  return match ? match[1] : null;
}

export function hashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
