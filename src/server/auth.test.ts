import { sql } from "drizzle-orm"
import { describe, expect, test } from "vitest"
import {
  checkPassword,
  createUser,
  hashPassword,
  login,
  logout,
  sessionUser,
  setup,
  setupNeeded,
} from "./auth.ts"
import { sessions } from "./schema.ts"
import { db } from "./test/db.ts"

// Produced by the Go 1984 implementation (crypto/pbkdf2, RawStdEncoding) for "senha-antiga-123".
const GO_HASH = "pbkdf2-sha256$600000$MDEyMzQ1Njc4OWFiY2RlZg$PZSoHwyAp/yWBuySOqXW5UbL9O+UHqQaqqBE0hPDtC8"
const admin = { name: "Ana", email: "ana@example.com", password: "senha-segura-123" }

describe("passwords", () => {
  test("accepts hashes produced by the Go system", async () => {
    expect(await checkPassword(GO_HASH, "senha-antiga-123")).toBe(true)
    expect(await checkPassword(GO_HASH, "senha-errada-123")).toBe(false)
  })

  test("hashes in the shared pbkdf2-sha256 format", async () => {
    const hash = await hashPassword("outra-senha-boa")
    expect(hash).toMatch(/^pbkdf2-sha256\$600000\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/)
    expect(await checkPassword(hash, "outra-senha-boa")).toBe(true)
  })

  test("rejects short passwords and malformed hashes", async () => {
    await expect(hashPassword("curta")).rejects.toMatchObject({ code: "weak_password" })
    expect(await checkPassword("pbkdf2-sha256$1$x$y", "qualquer-coisa")).toBe(false)
  })
})

describe("setup", () => {
  test("creates the first admin once", async () => {
    expect(await setupNeeded(db)).toBe(true)
    const token = await setup(db, admin)
    expect((await sessionUser(db, token))?.role).toBe("admin")
    expect(await setupNeeded(db)).toBe(false)
    await expect(setup(db, { ...admin, email: "b@example.com" })).rejects.toMatchObject({
      code: "already_setup",
    })
  })
})

describe("sessions", () => {
  test("login is case-insensitive on email and logout ends the session", async () => {
    await setup(db, admin)
    const token = await login(db, "ANA@example.com", admin.password)
    expect((await sessionUser(db, token))?.email).toBe("ana@example.com")
    await logout(db, token)
    expect(await sessionUser(db, token)).toBeNull()
  })

  test("wrong password and unknown email fail the same way", async () => {
    await setup(db, admin)
    await expect(login(db, admin.email, "senha-errada-123")).rejects.toMatchObject({
      code: "invalid_credentials",
    })
    await expect(login(db, "nobody@example.com", admin.password)).rejects.toMatchObject({
      code: "invalid_credentials",
    })
  })

  test("stores only the token hash and ignores expired sessions", async () => {
    const token = await setup(db, admin)
    const [row] = await db.select().from(sessions)
    expect(row?.tokenHash).not.toBe(token)
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    await db.update(sessions).set({ expiresAt: sql`now() - interval '1 second'` })
    expect(await sessionUser(db, token)).toBeNull()
  })
})

describe("users", () => {
  test("rejects a duplicate email regardless of case", async () => {
    await setup(db, admin)
    const member = {
      name: "Bia",
      email: "bia@example.com",
      password: "senha-segura-456",
      role: "member" as const,
    }
    await createUser(db, member)
    await expect(createUser(db, { ...member, email: "BIA@example.com" })).rejects.toMatchObject({
      code: "email_taken",
    })
  })
})
