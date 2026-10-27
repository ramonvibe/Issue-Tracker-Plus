import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import * as schema from "./schema.ts"

export function connect(url: string) {
  return drizzle(postgres(url, { onnotice: () => {} }), { schema })
}

export type DB = ReturnType<typeof connect>
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0]

export const migrateDb = (db: DB) =>
  migrate(db, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname })
