import { afterAll, beforeEach } from "vitest"
import { db, resetDb } from "./db.ts"

beforeEach(resetDb)
afterAll(() => db.$client.end())
