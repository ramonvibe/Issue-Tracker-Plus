import { sql } from "drizzle-orm"
import { beforeEach, describe, expect, test } from "vitest"
import { createUser } from "./auth.ts"
import { apiTokens } from "./schema.ts"
import { db } from "./test/db.ts"
import { createToken, listTokens, revokeToken, tokenUser } from "./tokens.ts"

let userId: number
beforeEach(async () => {
  userId = (
    await createUser(db, {
      name: "Ana",
      email: "ana@example.com",
      password: "senha-segura-123",
      role: "admin",
    })
  ).id
})

describe("api tokens", () => {
  test("the secret is shown once, stored only as a hash, and authenticates as its owner", async () => {
    const created = await createToken(db, userId, "claude-1")
    expect(created.token).toMatch(/^mf_[A-Za-z0-9_-]{43}$/)
    const [row] = await db.select().from(apiTokens)
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(await listTokens(db, userId))).not.toContain(created.token)
    expect(await tokenUser(db, created.token)).toMatchObject({
      tokenId: created.id,
      user: { id: userId, name: "Ana" },
    })
    expect(await tokenUser(db, "mf_wrong")).toBeNull()
  })

  test("records last use and stops working once revoked", async () => {
    const { id, token } = await createToken(db, userId, "ci")
    await tokenUser(db, token)
    expect((await listTokens(db, userId))[0]?.lastUsedAt).toBeInstanceOf(Date)
    await revokeToken(db, userId, id)
    expect(await tokenUser(db, token)).toBeNull()
    expect((await listTokens(db, userId))[0]?.revokedAt).toBeInstanceOf(Date)
  })

  test("users only see and revoke their own tokens", async () => {
    const other = await createUser(db, {
      name: "Bia",
      email: "bia@example.com",
      password: "senha-segura-456",
      role: "member",
    })
    const { id } = await createToken(db, userId, "mine")
    expect(await listTokens(db, other.id)).toEqual([])
    await expect(revokeToken(db, other.id, id)).rejects.toMatchObject({ status: 404 })
    const [{ n }] = (await db.execute(
      sql`select count(*)::int as n from api_tokens where revoked_at is null`,
    )) as unknown as [{ n: number }]
    expect(n).toBe(1)
  })

  test("names are required", async () => {
    await expect(createToken(db, userId, "  ")).rejects.toMatchObject({ status: 422 })
  })
})
