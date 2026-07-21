import { BadRequestException } from '@nestjs/common';
import {
  assertValueMatchesType,
  valueMatchesType,
} from '../../src/flags/value-type.util';

describe('valueMatchesType', () => {
  it('accepts values that match the declared flag type', () => {
    expect(valueMatchesType('boolean', true)).toBe(true);
    expect(valueMatchesType('boolean', false)).toBe(true);
    expect(valueMatchesType('string', 'variant-a')).toBe(true);
    expect(valueMatchesType('number', 42)).toBe(true);
    expect(valueMatchesType('number', 0.5)).toBe(true);
  });

  it('rejects values that do not match the declared flag type', () => {
    expect(valueMatchesType('boolean', 'true')).toBe(false);
    expect(valueMatchesType('boolean', 1)).toBe(false);
    expect(valueMatchesType('string', 7)).toBe(false);
    expect(valueMatchesType('number', 'seven')).toBe(false);
    expect(valueMatchesType('number', NaN)).toBe(false);
    expect(valueMatchesType('string', null)).toBe(false);
    expect(valueMatchesType('boolean', undefined)).toBe(false);
  });
});

describe('assertValueMatchesType', () => {
  it('passes silently for a matching value', () => {
    expect(() => assertValueMatchesType('string', 'ok')).not.toThrow();
  });

  it('throws a BadRequestException for a mismatched value', () => {
    expect(() => assertValueMatchesType('boolean', 'yes')).toThrow(
      BadRequestException,
    );
  });
});
