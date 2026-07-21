// Defaults point at the docker-compose services; export DATABASE_URL and
// REDIS_URL to run the suite against other instances.
process.env.DATABASE_URL ??=
  'postgresql://feature_flags:feature_flags@localhost:55432/feature_flags?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:56379';
process.env.LOG_LEVEL = 'silent';
