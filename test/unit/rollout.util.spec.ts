import { isInRollout, rolloutBucket } from '../../src/evaluation/rollout.util';

describe('rolloutBucket', () => {
  it('always returns the same bucket for the same flag key and user', () => {
    const first = rolloutBucket('new-checkout', 'user-123');

    for (let i = 0; i < 50; i += 1) {
      expect(rolloutBucket('new-checkout', 'user-123')).toBe(first);
    }
  });

  it('returns buckets within the 0-99 range', () => {
    for (let i = 0; i < 1000; i += 1) {
      const bucket = rolloutBucket('new-checkout', `user-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(100);
    }
  });

  it('assigns users independently per flag key', () => {
    const buckets = new Set<number>();
    for (const flagKey of ['flag-a', 'flag-b', 'flag-c', 'flag-d', 'flag-e']) {
      buckets.add(rolloutBucket(flagKey, 'user-123'));
    }
    // Five flags mapping one user to five identical buckets would mean the
    // flag key is being ignored.
    expect(buckets.size).toBeGreaterThan(1);
  });

  it('distributes users roughly uniformly', () => {
    let inHalf = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (rolloutBucket('new-checkout', `user-${i}`) < 50) {
        inHalf += 1;
      }
    }
    expect(inHalf).toBeGreaterThan(400);
    expect(inHalf).toBeLessThan(600);
  });
});

describe('isInRollout', () => {
  it('never includes users at 0 percent', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isInRollout('new-checkout', `user-${i}`, 0)).toBe(false);
    }
  });

  it('always includes users at 100 percent', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isInRollout('new-checkout', `user-${i}`, 100)).toBe(true);
    }
  });

  it('keeps users included when the percentage only increases', () => {
    const userId = 'user-123';
    const flagKey = 'new-checkout';
    let wasIncluded = false;

    for (let percentage = 0; percentage <= 100; percentage += 5) {
      const included = isInRollout(flagKey, userId, percentage);
      if (wasIncluded) {
        // Once a user is in the rollout, raising the percentage must never
        // remove them - this is what makes gradual rollouts stable.
        expect(included).toBe(true);
      }
      wasIncluded = included;
    }
  });
});
