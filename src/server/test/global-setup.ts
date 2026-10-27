import postgres from "postgres"
import { connect, migrateDb } from "../db.ts"
import { TEST_DATABASE_URL } from "./db.ts"

export async function recreateDatabase(databaseUrl: string) {
  const url = new URL(databaseUrl)
  const name = url.pathname.slice(1)
  url.pathname = "/postgres"
  const admin = postgres(url.href, { onnotice: () => {} })
  await admin.unsafe(`drop database if exists "${name}" with (force)`)
  await admin.unsafe(`create database "${name}"`)
  await admin.end()
}

export default async function setup() {
  await recreateDatabase(TEST_DATABASE_URL)
  const db = connect(TEST_DATABASE_URL)
  await migrateDb(db)
  await db.$client.end()
}
