#!/bin/sh
set -e

# Apply pending migrations before serving traffic when requested. Cloud Run
# and local docker-compose both set RUN_MIGRATIONS=true; `migrate deploy` is
# a no-op when the schema is already current, so concurrent instances are
# safe (Prisma takes an advisory lock).
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

exec node dist/main.js
