import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import type { DB } from "./db.ts"
import { AppError, isUniqueViolation } from "./errors.ts"
import { projects } from "./schema.ts"

export const projectInput = z.object({
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, "A chave deve ter de 2 a 10 letras ou números, começando por letra"),
  name: z.string().trim().min(1, "Informe o nome").max(120),
  repoFullName: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Use o formato dono/repositório")
    .nullish(),
})

export type Project = typeof projects.$inferSelect

export async function createProject(db: DB, input: z.infer<typeof projectInput>): Promise<Project> {
  try {
    const [project] = await db.insert(projects).values(input).returning()
    return project as Project
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(409, "key_taken", `A chave ${input.key} já está em uso`)
    throw error
  }
}

export const listProjects = (db: DB) => db.select().from(projects).orderBy(asc(projects.key))

export async function getProject(db: DB, key: string): Promise<Project> {
  const [project] = await db.select().from(projects).where(eq(projects.key, key))
  if (!project) throw new AppError(404, "not_found", `Projeto ${key} não encontrado`)
  return project
}
