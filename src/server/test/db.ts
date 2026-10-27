import { sql } from "drizzle-orm"
import { connect } from "../db.ts"

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://makeit:makeit@127.0.0.1:5433/makeit_test"

export const db = connect(TEST_DATABASE_URL)

export async function resetDb() {
  await db.execute(sql`
    do $$ declare t text; begin
      select string_agg(quote_ident(tablename), ', ') into t from pg_tables where schemaname = 'public';
      if t is not null then execute 'truncate ' || t || ' restart identity cascade'; end if;
    end $$`)
}
