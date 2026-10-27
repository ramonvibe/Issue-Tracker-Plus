import { recreateDatabase } from "../src/server/test/global-setup.ts"

await recreateDatabase(process.env.DATABASE_URL ?? "")
