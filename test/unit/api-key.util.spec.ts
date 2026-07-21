import {
  extractKeyPrefix,
  generateApiKey,
  hashApiKey,
} from '../../src/tenants/api-key.util';

describe('api-key util', () => {
  it('generates a key in the ffk_<prefix>_<secret> format', () => {
    const generated = generateApiKey();

    expect(generated.plaintext).toMatch(
      /^ffk_[A-Za-z0-9_-]{8}_[A-Za-z0-9_-]{20,}$/,
    );
    expect(generated.prefix).toHaveLength(8);
    expect(generated.plaintext).toContain(`ffk_${generated.prefix}_`);
  });

  it('stores only a hash that matches a recomputed hash of the plaintext', () => {
    const generated = generateApiKey();

    expect(generated.hash).not.toContain(generated.plaintext);
    expect(hashApiKey(generated.plaintext)).toBe(generated.hash);
  });

  it('produces unique keys and hashes across generations', () => {
    const first = generateApiKey();
    const second = generateApiKey();

    expect(first.plaintext).not.toBe(second.plaintext);
    expect(first.hash).not.toBe(second.hash);
  });

  it('extracts the prefix from a well-formed key', () => {
    const generated = generateApiKey();

    expect(extractKeyPrefix(generated.plaintext)).toBe(generated.prefix);
  });

  it('rejects malformed keys when extracting the prefix', () => {
    expect(extractKeyPrefix('not-an-api-key')).toBeNull();
    expect(extractKeyPrefix('ffk_short_x')).toBeNull();
    expect(extractKeyPrefix('')).toBeNull();
  });
});
