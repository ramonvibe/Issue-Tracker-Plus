import { asc, eq } from "drizzle-orm"
import { z } from "zod"
import type { DB } from "./db.ts"
import { AppError, isUniqueViolation } from "./errors.ts"
import { projects, type WipLimits } from "./schema.ts"

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

const limit = z.int().min(1).max(99).nullable().optional()
export const projectPatch = projectInput
  .omit({ key: true })
  .partial()
  .extend({
    // null removes the limit for that column.
    wipLimits: z.object({ in_progress: limit, review: limit }).optional(),
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

export async function updateProject(
  db: DB,
  key: string,
  patch: z.infer<typeof projectPatch>,
): Promise<Project> {
  const { wipLimits: limits, ...fields } = patch
  const wipLimits = { ...(await getProject(db, key)).wipLimits }
  for (const [status, value] of Object.entries(limits ?? {}) as [
    keyof WipLimits,
    number | null | undefined,
  ][]) {
    if (value === null) delete wipLimits[status]
    else if (value !== undefined) wipLimits[status] = value
  }
  const [project] = await db
    .update(projects)
    .set({ ...fields, wipLimits })
    .where(eq(projects.key, key))
    .returning()
  return project as Project
}
