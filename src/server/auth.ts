import { createHash, pbkdf2, randomBytes, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import { and, count, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"
import type { DB, Tx } from "./db.ts"
import { AppError, isUniqueViolation } from "./errors.ts"
import { ROLES, sessions, users } from "./schema.ts"

const derive = promisify(pbkdf2)
const ITERATIONS = 600_000
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Go's base64.RawStdEncoding: standard alphabet, no padding. Keeps hashes from the 1984 system valid.
const b64 = (bytes: Buffer) => bytes.toString("base64").replace(/=+$/, "")
const DUMMY_HASH = `pbkdf2-sha256$${ITERATIONS}$${"A".repeat(22)}$${"A".repeat(43)}`

export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000

export const loginInput = z.object({ email: z.string().max(254), password: z.string().max(256) })
export const userInput = z.object({
  name: z.string().trim().min(1, "Informe o nome").max(120),
  email: z.email("Digite um email válido").trim().toLowerCase().max(254),
  password: z.string().max(256),
  role: z.enum(ROLES).default("member"),
})
export const setupInput = userInput.omit({ role: true })

export type SessionUser = { id: number; name: string; email: string; role: (typeof ROLES)[number] }

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 256) {
    throw new AppError(422, "weak_password", "A senha deve ter entre 12 e 256 caracteres")
  }
  const salt = randomBytes(16)
  const key = await derive(password, salt, ITERATIONS, 32, "sha256")
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(key)}`
}

export async function checkPassword(hash: string, password: string) {
  const [alg, rounds, salt, expected] = hash.split("$")
  const iterations = Number(rounds)
  if (alg !== "pbkdf2-sha256" || !salt || !expected || hash.split("$").length !== 4) return false
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false
  const saltBytes = Buffer.from(salt, "base64")
  const expectedBytes = Buffer.from(expected, "base64")
  if (saltBytes.length !== 16 || expectedBytes.length !== 32 || password.length > 256) return false
  const key = await derive(password, saltBytes, iterations, 32, "sha256")
  return timingSafeEqual(key, expectedBytes)
}

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex")

async function createSession(db: DB | Tx, userId: number) {
  const token = randomBytes(32).toString("base64url")
  await db
    .insert(sessions)
    .values({ tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
  return token
}

export async function setupNeeded(db: DB) {
  const [row] = await db.select({ n: count() }).from(users)
  return row?.n === 0
}

// Creates the first admin and returns a session token. Only works while there are no users.
export function setup(db: DB, input: z.infer<typeof setupInput>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(1984)`)
    const [row] = await tx.select({ n: count() }).from(users)
    if (row?.n !== 0) throw new AppError(409, "already_setup", "A instalação já foi configurada")
    const user = await insertUser(tx, { ...input, role: "admin" })
    return createSession(tx, user.id)
  })
}

export const createUser = (db: DB, input: z.infer<typeof userInput>) => insertUser(db, input)

async function insertUser(db: DB | Tx, input: z.infer<typeof userInput>): Promise<SessionUser> {
  const passwordHash = await hashPassword(input.password)
  try {
    const [user] = await db
      .insert(users)
      .values({ name: input.name, email: input.email, passwordHash, role: input.role })
      .returning({ id: users.id, name: users.name, email: users.email, role: users.role })
    return user as SessionUser
  } catch (error) {
    if (isUniqueViolation(error))
      throw new AppError(409, "email_taken", "Já existe um usuário com esse email")
    throw error
  }
}

export async function login(db: DB, email: string, password: string) {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()))
  // Missing accounts still pay the derivation cost so timing does not reveal which emails exist.
  const ok = await checkPassword(user?.passwordHash ?? DUMMY_HASH, password)
  if (!user || !ok) throw new AppError(401, "invalid_credentials", "Email ou senha inválidos")
  return createSession(db, user.id)
}

export async function sessionUser(db: DB, token: string): Promise<SessionUser | null> {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, sql`now()`)))
  return user ?? null
}

export async function logout(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)))
}
