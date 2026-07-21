import { FlagValueType } from '../flags/value-type.util';
import { isInRollout } from './rollout.util';

export interface TargetingRule {
  attribute: string;
  values: string[];
}

export interface EvaluableFlag {
  key: string;
  type: FlagValueType;
  defaultValue: unknown;
  status: string;
  config: {
    enabled: boolean;
    rolloutPercentage: number;
    targetingRules: TargetingRule[] | null;
    variantValue: unknown;
  };
}

export type EvaluationReason =
  'archived' | 'disabled' | 'targeting_match' | 'rollout' | 'not_in_rollout';

export interface EvaluationResult {
  value: unknown;
  reason: EvaluationReason;
}

function onValue(flag: EvaluableFlag): unknown {
  if (
    flag.config.variantValue !== null &&
    flag.config.variantValue !== undefined
  ) {
    return flag.config.variantValue;
  }
  return flag.type === 'boolean' ? true : flag.defaultValue;
}

function matchesTargeting(
  rules: TargetingRule[] | null,
  context: Record<string, unknown>,
): boolean {
  if (!rules || rules.length === 0) {
    return false;
  }
  return rules.some((rule) => {
    const contextValue = context[rule.attribute];
    return (
      typeof contextValue === 'string' && rule.values.includes(contextValue)
    );
  });
}

export function evaluateFlag(
  flag: EvaluableFlag,
  userId: string,
  context: Record<string, unknown>,
): EvaluationResult {
  if (flag.status === 'archived') {
    return { value: flag.defaultValue, reason: 'archived' };
  }
  if (!flag.config.enabled) {
    return { value: flag.defaultValue, reason: 'disabled' };
  }
  if (matchesTargeting(flag.config.targetingRules, context)) {
    return { value: onValue(flag), reason: 'targeting_match' };
  }
  if (isInRollout(flag.key, userId, flag.config.rolloutPercentage)) {
    return { value: onValue(flag), reason: 'rollout' };
  }
  return { value: flag.defaultValue, reason: 'not_in_rollout' };
}
