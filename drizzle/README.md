# Drizzle Migrations

Generate SQL migrations from `server/db/schema.ts` after schema changes:

```bash
bunx drizzle-kit generate
```

Apply/check generated migrations using the environment-specific PostgreSQL
database configured by `DATABASE_URL`. This project currently keeps migration
generation explicit so schema changes can be reviewed before they are applied.
