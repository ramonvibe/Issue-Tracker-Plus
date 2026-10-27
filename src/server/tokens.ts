import { randomBytes } from "node:crypto"
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"
import { type SessionUser, tokenHash } from "./auth.ts"
import type { DB } from "./db.ts"
import { AppError } from "./errors.ts"
import { apiTokens, users } from "./schema.ts"

export const tokenInput = z.object({ name: z.string().trim().min(1, "Dê um nome ao token").max(80) })

const listed = {
  id: apiTokens.id,
  name: apiTokens.name,
  lastUsedAt: apiTokens.lastUsedAt,
  revokedAt: apiTokens.revokedAt,
  createdAt: apiTokens.createdAt,
}

// Returns the secret once; only its hash is stored.
export async function createToken(db: DB, userId: number, name: string) {
  const parsed = tokenInput.safeParse({ name })
  if (!parsed.success) throw new AppError(422, "validation", "Dê um nome ao token")
  const token = `mf_${randomBytes(32).toString("base64url")}`
  const [row] = await db
    .insert(apiTokens)
    .values({ userId, name: parsed.data.name, tokenHash: tokenHash(token) })
    .returning(listed)
  return { ...(row as NonNullable<typeof row>), token }
}

export const listTokens = (db: DB, userId: number) =>
  db.select(listed).from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.id))

export async function revokeToken(db: DB, userId: number, id: number) {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: sql`coalesce(${apiTokens.revokedAt}, now())` })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)))
    .returning({ id: apiTokens.id })
  if (!row) throw new AppError(404, "not_found", "Token não encontrado")
}

export async function tokenUser(
  db: DB,
  token: string,
): Promise<{ user: SessionUser; tokenId: number } | null> {
  const [row] = await db
    .select({ tokenId: apiTokens.id, id: users.id, name: users.name, email: users.email, role: users.role })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(and(eq(apiTokens.tokenHash, tokenHash(token)), isNull(apiTokens.revokedAt)))
  if (!row) return null
  // At most one write per token per minute, so busy agents do not turn every read into a write.
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiTokens.id, row.tokenId),
        or(isNull(apiTokens.lastUsedAt), lt(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`)),
      ),
    )
  const { tokenId, ...user } = row
  return { user, tokenId }
}
