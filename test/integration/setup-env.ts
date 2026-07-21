// Defaults for running integration tests against the local docker-compose
// services; CI overrides these with its own service URLs.
process.env.DATABASE_URL ??=
  'postgresql://feature_flags:feature_flags@localhost:55432/feature_flags?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:56379';
process.env.LOG_LEVEL = 'silent';
