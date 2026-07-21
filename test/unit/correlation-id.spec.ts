import {
  CORRELATION_ID_HEADER,
  resolveCorrelationId,
} from '../../src/common/http/correlation-id';

describe('resolveCorrelationId', () => {
  it('preserves a valid correlation ID supplied by the caller', () => {
    expect(resolveCorrelationId('request-123')).toBe('request-123');
  });

  it('generates a correlation ID when the header is missing', () => {
    const correlationId = resolveCorrelationId(undefined);

    expect(correlationId).toEqual(expect.any(String));
    expect(correlationId).not.toHaveLength(0);
  });

  it('uses the standard correlation ID header', () => {
    expect(CORRELATION_ID_HEADER).toBe('x-correlation-id');
  });
});
