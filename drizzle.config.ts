import type { Config } from 'drizzle-kit'

/**
 * Used only by `drizzle-kit generate`, which reads the schema and emits SQL
 * migrations without connecting to anything. Applying them is done by
 * `scripts/migrate.ts`, which works against both PGlite and real Postgres.
 */
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
} satisfies Config
