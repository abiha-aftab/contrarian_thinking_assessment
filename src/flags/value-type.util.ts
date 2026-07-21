import { BadRequestException } from '@nestjs/common';

export type FlagValueType = 'boolean' | 'string' | 'number';

export function valueMatchesType(type: FlagValueType, value: unknown): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
  }
}

export function assertValueMatchesType(
  type: FlagValueType,
  value: unknown,
): void {
  if (!valueMatchesType(type, value)) {
    throw new BadRequestException(
      `Value ${JSON.stringify(value)} does not match the flag type "${type}"`,
    );
  }
}
