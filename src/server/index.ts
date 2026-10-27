import { serve } from "@hono/node-server"
import { createApp } from "./app.ts"
import { connect, migrateDb } from "./db.ts"

const port = Number(process.env.PORT ?? 8080)
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`
const db = connect(process.env.DATABASE_URL ?? "postgres://makeit:makeit@127.0.0.1:5433/makeit")

await migrateDb(db)
const app = createApp({
  db,
  secureCookies: process.env.SECURE_COOKIES
    ? process.env.SECURE_COOKIES === "true"
    : baseUrl.startsWith("https://"),
  staticDir: process.env.STATIC_DIR ?? "dist/web",
})
const server = serve({ fetch: app.fetch, port }, () => console.log(`makeit-fast ready on ${baseUrl}`))

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => db.$client.end().then(() => process.exit(0))))
}
