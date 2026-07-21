import { createHash } from 'node:crypto';

/**
 * Maps a (flagKey, userId) pair onto a stable bucket in [0, 100).
 *
 * SHA-256 gives a uniform distribution, and including the flag key means the
 * same user lands in an independent bucket per flag, so enabling one flag at
 * 10% does not correlate with any other flag's rollout population.
 */
export function rolloutBucket(flagKey: string, userId: string): number {
  const digest = createHash('sha256')
    .update(`${flagKey}:${userId}`)
    .digest('hex');

  return parseInt(digest.slice(0, 8), 16) % 100;
}

/**
 * A user is in the rollout when their bucket is below the percentage. Because
 * the bucket is fixed, raising the percentage only ever adds users - nobody
 * who already has the flag loses it.
 */
export function isInRollout(
  flagKey: string,
  userId: string,
  percentage: number,
): boolean {
  return rolloutBucket(flagKey, userId) < percentage;
}
