/**
 * Reset the isolated test database by dropping and recreating the public schema.
 * Never point this at staging or production.
 */
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  if (
    !url.includes('ev_telemetry_test') &&
    process.env.ALLOW_TEST_DB_RESET !== 'true'
  ) {
    throw new Error(
      'Refusing to reset a database that does not look like the test DB. Set ALLOW_TEST_DB_RESET=true to override.',
    );
  }

  const sql = postgres(url, { max: 1 });
  await sql`drop schema if exists public cascade`;
  await sql`create schema public`;
  await sql`create extension if not exists pgcrypto`;
  await sql.end({ timeout: 5 });
  console.log('Test database schema reset.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
