import { randomUUID } from 'node:crypto';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

const VALID_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function resolveCorrelationId(
  incoming: string | string[] | undefined,
): string {
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;

  return candidate && VALID_CORRELATION_ID.test(candidate)
    ? candidate
    : randomUUID();
}
