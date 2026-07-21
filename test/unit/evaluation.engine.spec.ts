import {
  EvaluableFlag,
  evaluateFlag,
} from '../../src/evaluation/evaluation.engine';
import { rolloutBucket } from '../../src/evaluation/rollout.util';

function booleanFlag(overrides: Partial<EvaluableFlag> = {}): EvaluableFlag {
  return {
    key: 'new-checkout',
    type: 'boolean',
    defaultValue: false,
    status: 'active',
    config: {
      enabled: true,
      rolloutPercentage: 100,
      targetingRules: null,
      variantValue: null,
    },
    ...overrides,
  };
}

function userInRollout(flagKey: string, percentage: number): string {
  for (let i = 0; i < 10000; i += 1) {
    if (rolloutBucket(flagKey, `user-${i}`) < percentage) {
      return `user-${i}`;
    }
  }
  throw new Error('no user found in rollout');
}

function userOutsideRollout(flagKey: string, percentage: number): string {
  for (let i = 0; i < 10000; i += 1) {
    if (rolloutBucket(flagKey, `user-${i}`) >= percentage) {
      return `user-${i}`;
    }
  }
  throw new Error('no user found outside rollout');
}

describe('evaluateFlag', () => {
  it('serves the default value for an archived flag', () => {
    const flag = booleanFlag({ status: 'archived' });

    expect(evaluateFlag(flag, 'user-123', {})).toEqual({
      value: false,
      reason: 'archived',
    });
  });

  it('serves the default value when the flag is disabled in the environment', () => {
    const flag = booleanFlag({
      config: { ...booleanFlag().config, enabled: false },
    });

    expect(evaluateFlag(flag, 'user-123', {})).toEqual({
      value: false,
      reason: 'disabled',
    });
  });

  it('serves true for an enabled boolean flag when the user is in the rollout', () => {
    const flag = booleanFlag({
      config: { ...booleanFlag().config, rolloutPercentage: 40 },
    });
    const userId = userInRollout(flag.key, 40);

    expect(evaluateFlag(flag, userId, {})).toEqual({
      value: true,
      reason: 'rollout',
    });
  });

  it('serves the default value when the user is outside the rollout', () => {
    const flag = booleanFlag({
      config: { ...booleanFlag().config, rolloutPercentage: 40 },
    });
    const userId = userOutsideRollout(flag.key, 40);

    expect(evaluateFlag(flag, userId, {})).toEqual({
      value: false,
      reason: 'not_in_rollout',
    });
  });

  it('serves the variant value for string flags in the rollout', () => {
    const flag = booleanFlag({
      type: 'string',
      defaultValue: 'control',
      config: {
        enabled: true,
        rolloutPercentage: 100,
        targetingRules: null,
        variantValue: 'variant-a',
      },
    });

    expect(evaluateFlag(flag, 'user-123', {})).toEqual({
      value: 'variant-a',
      reason: 'rollout',
    });
  });

  it('serves the variant value for number flags in the rollout', () => {
    const flag = booleanFlag({
      type: 'number',
      defaultValue: 10,
      config: {
        enabled: true,
        rolloutPercentage: 100,
        targetingRules: null,
        variantValue: 25,
      },
    });

    expect(evaluateFlag(flag, 'user-123', {})).toEqual({
      value: 25,
      reason: 'rollout',
    });
  });

  it('serves the on-value when a targeting rule matches, bypassing the rollout', () => {
    const flag = booleanFlag({
      config: {
        enabled: true,
        rolloutPercentage: 0,
        targetingRules: [{ attribute: 'country', values: ['US', 'CA'] }],
        variantValue: null,
      },
    });

    expect(evaluateFlag(flag, 'user-123', { country: 'US' })).toEqual({
      value: true,
      reason: 'targeting_match',
    });
  });

  it('falls back to the rollout when no targeting rule matches', () => {
    const flag = booleanFlag({
      config: {
        enabled: true,
        rolloutPercentage: 0,
        targetingRules: [{ attribute: 'country', values: ['US'] }],
        variantValue: null,
      },
    });

    expect(evaluateFlag(flag, 'user-123', { country: 'DE' })).toEqual({
      value: false,
      reason: 'not_in_rollout',
    });
  });

  it('is deterministic for the same user and flag', () => {
    const flag = booleanFlag({
      config: { ...booleanFlag().config, rolloutPercentage: 50 },
    });

    const first = evaluateFlag(flag, 'user-42', {});
    for (let i = 0; i < 20; i += 1) {
      expect(evaluateFlag(flag, 'user-42', {})).toEqual(first);
    }
  });
});
