import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration.
 *
 * Migrations are generated and applied explicitly (`pnpm db:generate`,
 * `pnpm db:migrate`). Never use `drizzle-kit push` against staging/production.
 */
export default defineConfig({
  schema: './src/server/infrastructure/db/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
  },
  migrations: {
    prefix: 'timestamp',
    table: '__drizzle_migrations',
    schema: 'drizzle',
  },
  strict: true,
  verbose: true,
});
