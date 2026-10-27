import { and, asc, eq, gt, inArray, lt, max, min, ne, type SQL, sql } from "drizzle-orm"
import { generateKeyBetween } from "fractional-indexing"
import { z } from "zod"
import type { DB, Tx } from "./db.ts"
import { AppError } from "./errors.ts"
import { getProject } from "./projects.ts"
import {
  acceptanceCriteria,
  comments,
  issueEvents,
  issues,
  projects,
  STATUSES,
  type Status,
  type WipLimits,
} from "./schema.ts"

// A person (session) or an agent (API token). Agents leave userId empty, as the data model asks.
export type Actor = { userId?: number; tokenId?: number }
export type BoardStatus = Exclude<Status, "discarded">

const REF = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})$/
// Columns past Ideia are a commitment: they need a definition of done.
const NEEDS_CRITERIA: Status[] = ["ready", "in_progress", "review", "done"]
const ENTERED_AT = { ready: "readyAt", in_progress: "startedAt", review: "reviewAt", done: "doneAt" } as const

export const criterionInput = z.object({
  text: z.string().trim().min(1, "Descreva o critério").max(500),
  testRef: z.string().trim().max(300).nullish(),
})
export const criterionPatch = criterionInput.partial().extend({ checked: z.boolean().optional() })
const title = z.string().trim().min(1, "Informe o título").max(240)
const description = z.string().max(20_000)
const contextFiles = z
  .array(z.string().trim().max(500))
  .max(100)
  .transform((files) => files.filter(Boolean))
export const issueInput = z.object({
  title,
  description: description.default(""),
  contextFiles: contextFiles.default([]),
  criteria: z.array(criterionInput).max(50).default([]),
})
export const issuePatch = z.object({
  title: title.optional(),
  description: description.optional(),
  contextFiles: contextFiles.optional(),
})
export const commentInput = z.object({ body: z.string().trim().min(1, "Escreva o comentário").max(10_000) })
export const moveInput = z.object({
  status: z.enum(STATUSES),
  // Refs of the cards that end up right above (`after`) and right below (`before`) the moved one.
  after: z.string().optional(),
  before: z.string().optional(),
  note: z.string().max(10_000).optional(),
})

const ref = (key: string, number: number) => `${key}-${number}`

async function findIssue(db: DB | Tx, reference: string, lock = false) {
  const match = REF.exec(reference)
  const notFound = new AppError(404, "not_found", `Issue ${reference} não encontrada`)
  if (!match) throw notFound
  const query = db
    .select({ issue: issues, key: projects.key })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .where(and(eq(projects.key, match[1] as string), eq(issues.number, Number(match[2]))))
  const [row] = lock ? await query.for("update", { of: issues }) : await query
  if (!row) throw notFound
  return { ...row.issue, ref: ref(row.key, row.issue.number) }
}

const logEvent = (tx: Tx, issueId: number, actor: Actor, kind: string, data: Record<string, unknown> = {}) =>
  tx
    .insert(issueEvents)
    .values({ issueId, actorId: actor.userId ?? null, tokenId: actor.tokenId ?? null, kind, data })

export function createIssue(db: DB, key: string, input: z.infer<typeof issueInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    // The row lock on the project serializes creations: no duplicate numbers or positions.
    const [project] = await tx
      .update(projects)
      .set({ nextIssueNumber: sql`${projects.nextIssueNumber} + 1` })
      .where(eq(projects.key, key))
      .returning({ id: projects.id, number: sql<number>`${projects.nextIssueNumber} - 1` })
    if (!project) throw new AppError(404, "not_found", `Projeto ${key} não encontrado`)
    const [top] = await tx
      .select({ position: min(issues.position) })
      .from(issues)
      .where(and(eq(issues.projectId, project.id), eq(issues.status, "idea")))
    const [issue] = await tx
      .insert(issues)
      .values({
        projectId: project.id,
        number: project.number,
        title: input.title,
        description: input.description,
        contextFiles: input.contextFiles,
        position: generateKeyBetween(null, top?.position ?? null),
      })
      .returning()
    if (!issue) throw new Error("insert returned no row")
    if (input.criteria.length) {
      await tx.insert(acceptanceCriteria).values(input.criteria.map((c) => ({ ...c, issueId: issue.id })))
    }
    await logEvent(tx, issue.id, actor, "created")
    return { ...issue, ref: ref(key, issue.number) }
  })
}

// Two queries: resolve the ref, then one relational query that aggregates criteria, comments and events.
export async function getIssue(db: DB, reference: string) {
  const { id, ref } = await findIssue(db, reference)
  const named = { columns: { id: true, name: true } } as const
  const issue = await db.query.issues.findFirst({
    where: eq(issues.id, id),
    with: {
      criteria: { orderBy: (c, { asc }) => [asc(c.id)] },
      comments: { orderBy: (c, { asc }) => [asc(c.id)], with: { author: named, token: named } },
      events: { orderBy: (e, { asc }) => [asc(e.id)], with: { actor: named, token: named } },
    },
  })
  if (!issue) throw new AppError(404, "not_found", `Issue ${reference} não encontrada`)
  return { ...issue, ref }
}

export function updateIssue(db: DB, reference: string, patch: z.infer<typeof issuePatch>, actor: Actor) {
  return db.transaction(async (tx) => {
    const issue = await findIssue(tx, reference, true)
    const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
      (field) => patch[field] !== undefined && JSON.stringify(patch[field]) !== JSON.stringify(issue[field]),
    )
    if (!changed.length) return issue
    const [updated] = await tx
      .update(issues)
      .set({ ...Object.fromEntries(changed.map((f) => [f, patch[f]])), updatedAt: sql`now()` })
      .where(eq(issues.id, issue.id))
      .returning()
    await logEvent(tx, issue.id, actor, "edited", { fields: changed })
    return { ...(updated as typeof issues.$inferSelect), ref: issue.ref }
  })
}

export async function addComment(db: DB, reference: string, body: string, actor: Actor) {
  const parsed = commentInput.safeParse({ body })
  if (!parsed.success) throw new AppError(422, "validation", "Escreva o comentário")
  const issue = await findIssue(db, reference)
  const [comment] = await db
    .insert(comments)
    .values({
      issueId: issue.id,
      authorId: actor.userId ?? null,
      tokenId: actor.tokenId ?? null,
      body: parsed.data.body,
    })
    .returning()
  return comment as typeof comments.$inferSelect
}

export async function board(db: DB, key: string) {
  const project = await getProject(db, key)
  const rows = await db
    .select({
      number: issues.number,
      title: issues.title,
      status: issues.status,
      position: issues.position,
      criteriaTotal: sql<number>`count(${acceptanceCriteria.id})::int`,
      criteriaChecked: sql<number>`(count(${acceptanceCriteria.id}) filter (where ${acceptanceCriteria.checked}))::int`,
    })
    .from(issues)
    .leftJoin(acceptanceCriteria, eq(acceptanceCriteria.issueId, issues.id))
    .where(
      and(
        eq(issues.projectId, project.id),
        ne(issues.status, "discarded"),
        // shortcut: Concluída shows only the last 14 days; add paging if people need older ones on the board.
        sql`(${issues.status} <> 'done' or ${issues.doneAt} > now() - interval '14 days')`,
      ),
    )
    .groupBy(issues.id)
    .orderBy(asc(issues.position), asc(issues.id))
  const columns: Record<BoardStatus, (Omit<(typeof rows)[number], "status"> & { ref: string })[]> = {
    idea: [],
    ready: [],
    in_progress: [],
    review: [],
    done: [],
  }
  for (const { status, ...card } of rows) {
    columns[status as BoardStatus].push({ ...card, ref: ref(key, card.number) })
  }
  return { project, columns }
}

async function positionIn(
  tx: Tx,
  projectId: number,
  status: Status,
  selfId: number,
  input: z.infer<typeof moveInput>,
) {
  const neighbour = async (reference: string | undefined) => {
    if (!reference) return null
    const issue = await findIssue(tx, reference).catch(() => null)
    if (!issue || issue.projectId !== projectId || issue.status !== status || issue.id === selfId) {
      throw new AppError(422, "invalid_position", `${reference} não está na coluna de destino`)
    }
    return issue.position
  }
  const column = and(eq(issues.projectId, projectId), eq(issues.status, status), ne(issues.id, selfId))
  const edge = async (agg: SQL<string | null>, where: SQL | undefined) =>
    (await tx.select({ p: agg }).from(issues).where(where))[0]?.p ?? null
  let above = await neighbour(input.after)
  let below = await neighbour(input.before)
  if (above !== null && below === null)
    below = await edge(min(issues.position), and(column, gt(issues.position, above)))
  else if (above === null && below !== null)
    above = await edge(max(issues.position), and(column, lt(issues.position, below)))
  else if (above === null) above = await edge(max(issues.position), column)
  try {
    return generateKeyBetween(above, below)
  } catch {
    throw new AppError(422, "invalid_position", "Posição inválida: `after` precisa vir antes de `before`")
  }
}

const LABEL: Record<Status, string> = {
  idea: "Ideia",
  ready: "Pronta",
  in_progress: "Em execução",
  review: "Revisão",
  done: "Concluída",
  discarded: "Descartada",
}

async function checkWip(tx: Tx, projectId: number, limits: WipLimits, to: Status) {
  const rows = await tx
    .select({ status: issues.status, n: sql<number>`count(*)::int` })
    .from(issues)
    .where(and(eq(issues.projectId, projectId), inArray(issues.status, ["in_progress", "review"])))
    .groupBy(issues.status)
  const count = (status: Status) => rows.find((r) => r.status === status)?.n ?? 0
  const limit = limits[to as keyof WipLimits]
  if (limit !== undefined && count(to) >= limit) {
    throw new AppError(409, "wip_limit", `${LABEL[to]} está no limite de WIP (${count(to)}/${limit})`)
  }
  // Agents parallelize, reviewers do not: a full Revisão stops new work from starting.
  if (to === "in_progress" && limits.review !== undefined && count("review") >= limits.review) {
    throw new AppError(
      409,
      "wip_limit",
      `Revisão está cheia (${count("review")}/${limits.review}): revise antes de puxar mais trabalho`,
    )
  }
}

export function moveIssue(db: DB, reference: string, input: z.infer<typeof moveInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const current = await findIssue(tx, reference)
    // Lock the project first, then the issue: moves in one project are serialized (positions, WIP counts).
    const [project] = await tx
      .select({ wipLimits: projects.wipLimits })
      .from(projects)
      .where(eq(projects.id, current.projectId))
      .for("update")
    const issue = await findIssue(tx, reference, true)
    const from = issue.status
    const to = input.status
    const keepPosition = from === to && !input.after && !input.before

    if (from !== to) {
      const criteria = await tx
        .select({ checked: acceptanceCriteria.checked })
        .from(acceptanceCriteria)
        .where(eq(acceptanceCriteria.issueId, issue.id))
      if (NEEDS_CRITERIA.includes(to) && criteria.length === 0) {
        throw new AppError(
          422,
          "criteria_required",
          "Adicione pelo menos um critério de aceite antes de seguir",
        )
      }
      if (to === "done" && criteria.some((c) => !c.checked)) {
        throw new AppError(422, "criteria_open", "Marque todos os critérios de aceite antes de concluir")
      }
      if (from === "review" && to === "in_progress") {
        const note = input.note?.trim()
        if (!note) throw new AppError(422, "note_required", "Explique o que faltou para devolver a issue")
        const [comment] = await tx
          .insert(comments)
          .values({
            issueId: issue.id,
            authorId: actor.userId ?? null,
            tokenId: actor.tokenId ?? null,
            body: note,
          })
          .returning({ id: comments.id })
        await logEvent(tx, issue.id, actor, "rejected", { note, commentId: comment?.id })
      }
    }

    // Rejection sends work back without pulling anything new, so it is never blocked by WIP.
    if (from !== to && !(from === "review" && to === "in_progress")) {
      await checkWip(tx, issue.projectId, project?.wipLimits ?? {}, to)
    }

    const position = keepPosition
      ? issue.position
      : await positionIn(tx, issue.projectId, to, issue.id, input)
    const enteredAt =
      from !== to && to in ENTERED_AT ? { [ENTERED_AT[to as keyof typeof ENTERED_AT]]: sql`now()` } : {}
    const [updated] = await tx
      .update(issues)
      .set({ status: to, position, updatedAt: sql`now()`, ...enteredAt })
      .where(eq(issues.id, issue.id))
      .returning({ status: issues.status, position: issues.position })
    if (from !== to) await logEvent(tx, issue.id, actor, "moved", { from, to })
    return { ref: issue.ref, ...(updated as { status: Status; position: string }) }
  })
}

export function addCriterion(db: DB, reference: string, input: z.infer<typeof criterionInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const issue = await findIssue(tx, reference, true)
    const [criterion] = await tx
      .insert(acceptanceCriteria)
      .values({ ...input, issueId: issue.id })
      .returning()
    await logEvent(tx, issue.id, actor, "criteria_changed", {
      action: "added",
      id: criterion?.id,
      text: input.text,
    })
    return criterion as typeof acceptanceCriteria.$inferSelect
  })
}

export function updateCriterion(
  db: DB,
  reference: string,
  id: number,
  patch: z.infer<typeof criterionPatch>,
  actor: Actor,
) {
  return db.transaction(async (tx) => {
    const issue = await findIssue(tx, reference, true)
    const [criterion] = await tx
      .update(acceptanceCriteria)
      .set(patch)
      .where(and(eq(acceptanceCriteria.id, id), eq(acceptanceCriteria.issueId, issue.id)))
      .returning()
    if (!criterion) throw new AppError(404, "not_found", "Critério não encontrado")
    const action = patch.checked === undefined ? "edited" : patch.checked ? "checked" : "unchecked"
    await logEvent(tx, issue.id, actor, "criteria_changed", { action, id })
    return criterion
  })
}

export function deleteCriterion(db: DB, reference: string, id: number, actor: Actor) {
  return db.transaction(async (tx) => {
    const issue = await findIssue(tx, reference, true)
    const remaining = await tx
      .select({ id: acceptanceCriteria.id })
      .from(acceptanceCriteria)
      .where(eq(acceptanceCriteria.issueId, issue.id))
    if (!remaining.some((c) => c.id === id)) throw new AppError(404, "not_found", "Critério não encontrado")
    if (remaining.length === 1 && NEEDS_CRITERIA.includes(issue.status)) {
      throw new AppError(
        422,
        "criteria_required",
        "Uma issue fora de Ideia precisa de pelo menos um critério",
      )
    }
    await tx.delete(acceptanceCriteria).where(eq(acceptanceCriteria.id, id))
    await logEvent(tx, issue.id, actor, "criteria_changed", { action: "removed", id })
  })
}

const branch = z
  .string()
  .trim()
  .max(200)
  .regex(/^[\w./-]+$/, "Nome de branch inválido")
const prUrl = z.url({ protocol: /^https?$/, error: "URL do PR inválida" }).max(500)
// Accepts the documented snake_case `pr_url` as well as camelCase `prUrl`.
export const prInput = z
  .object({ branch: branch.optional(), pr_url: prUrl.optional(), prUrl: prUrl.optional() })
  .transform(({ branch, pr_url, prUrl }) => ({ branch, prUrl: prUrl ?? pr_url }))
  .refine((v) => v.branch || v.prUrl, "Informe a branch ou a URL do PR")

export function linkPr(db: DB, reference: string, input: z.infer<typeof prInput>, actor: Actor) {
  return db.transaction(async (tx) => {
    const issue = await findIssue(tx, reference, true)
    const number = input.prUrl ? Number(/\/pull\/(\d+)/.exec(input.prUrl)?.[1]) || null : undefined
    const [updated] = await tx
      .update(issues)
      .set({
        ...(input.branch && { branch: input.branch }),
        ...(input.prUrl && { prUrl: input.prUrl, prNumber: number, prState: issue.prState ?? "open" }),
        updatedAt: sql`now()`,
      })
      .where(eq(issues.id, issue.id))
      .returning({
        branch: issues.branch,
        prUrl: issues.prUrl,
        prNumber: issues.prNumber,
        prState: issues.prState,
      })
    await logEvent(tx, issue.id, actor, "pr_linked", { branch: input.branch, prUrl: input.prUrl })
    return { ref: issue.ref, ...(updated as NonNullable<typeof updated>) }
  })
}
