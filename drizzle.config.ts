import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error('DATABASE_URL is required to run drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/infrastructure/db/schema/index.ts',
  out: './drizzle/migrations',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
