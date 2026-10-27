import { eq, sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { beforeEach, describe, expect, test } from "vitest"
import { createUser } from "./auth.ts"
import {
  addComment,
  addCriterion,
  board,
  createIssue,
  deleteCriterion,
  getIssue,
  issueInput,
  issuePatch,
  linkPr,
  moveIssue,
  prInput,
  updateCriterion,
  updateIssue,
} from "./issues.ts"
import { createProject, updateProject } from "./projects.ts"
import * as schema from "./schema.ts"
import { comments, issueEvents } from "./schema.ts"
import { db } from "./test/db.ts"

let actor: { userId: number }

beforeEach(async () => {
  const user = await createUser(db, {
    name: "Ana",
    email: "ana@example.com",
    password: "senha-segura-123",
    role: "admin",
  })
  actor = { userId: user.id }
  await createProject(db, { key: "PLAT", name: "Plataforma" })
})

const create = (title: string, criteria: string[] = []) =>
  createIssue(db, "PLAT", issueInput.parse({ title, criteria: criteria.map((text) => ({ text })) }), actor)

const events = async (ref: string) => {
  const issue = await getIssue(db, ref)
  return db.select().from(issueEvents).where(eq(issueEvents.issueId, issue.id)).orderBy(issueEvents.id)
}

const columnRefs = async (status: "idea" | "ready" | "in_progress" | "review" | "done") =>
  (await board(db, "PLAT")).columns[status].map((c) => c.ref)

describe("create", () => {
  test("numbers are sequential per project, even when created concurrently", async () => {
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) => create(`Issue ${i}`)))
    expect(created.map((i) => i.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(new Set(created.map((i) => i.position)).size).toBe(10)
  })

  test("new ideas land on top of Ideia with criteria and a created event", async () => {
    await create("Primeira")
    const second = await create("Segunda", ["Retorna 404 para chave inexistente"])
    expect(second).toMatchObject({ ref: "PLAT-2", status: "idea" })
    expect(await columnRefs("idea")).toEqual(["PLAT-2", "PLAT-1"])
    expect((await getIssue(db, "PLAT-2")).criteria).toMatchObject([
      { text: "Retorna 404 para chave inexistente", checked: false, testRef: null },
    ])
    expect(await events("PLAT-2")).toMatchObject([{ kind: "created", actorId: actor.userId }])
  })

  test("unknown references are 404", async () => {
    await expect(getIssue(db, "PLAT-99")).rejects.toMatchObject({ status: 404 })
    await expect(getIssue(db, "plat-1")).rejects.toMatchObject({ status: 404 })
  })
})

describe("transitions", () => {
  test("leaving Ideia requires at least one criterion", async () => {
    await create("Sem critério")
    for (const status of ["ready", "in_progress", "review", "done"] as const) {
      await expect(moveIssue(db, "PLAT-1", { status }, actor)).rejects.toMatchObject({
        status: 422,
        code: "criteria_required",
      })
    }
    await addCriterion(db, "PLAT-1", { text: "Critério verificável" }, actor)
    const moved = await moveIssue(db, "PLAT-1", { status: "ready" }, actor)
    expect(moved.status).toBe("ready")
    expect((await getIssue(db, "PLAT-1")).readyAt).toBeInstanceOf(Date)
    expect((await events("PLAT-1")).at(-1)).toMatchObject({
      kind: "moved",
      actorId: actor.userId,
      data: { from: "idea", to: "ready" },
    })
  })

  test("rejecting from Revisão requires a note, which becomes a comment and a rejected event", async () => {
    await create("Rejeitável", ["Critério"])
    await moveIssue(db, "PLAT-1", { status: "review" }, actor)
    await expect(moveIssue(db, "PLAT-1", { status: "in_progress" }, actor)).rejects.toMatchObject({
      code: "note_required",
    })
    await expect(
      moveIssue(db, "PLAT-1", { status: "in_progress", note: "   " }, actor),
    ).rejects.toMatchObject({
      code: "note_required",
    })
    await moveIssue(db, "PLAT-1", { status: "in_progress", note: "Faltou o teste de borda" }, actor)
    const issue = await getIssue(db, "PLAT-1")
    expect(await db.select().from(comments).where(eq(comments.issueId, issue.id))).toMatchObject([
      { body: "Faltou o teste de borda", authorId: actor.userId },
    ])
    expect((await events("PLAT-1")).slice(-2)).toMatchObject([
      { kind: "rejected", data: { note: "Faltou o teste de borda" } },
      { kind: "moved", data: { from: "review", to: "in_progress" } },
    ])
  })

  test("Concluída requires every criterion checked", async () => {
    await create("Concluível", ["Um", "Dois"])
    await moveIssue(db, "PLAT-1", { status: "review" }, actor)
    await expect(moveIssue(db, "PLAT-1", { status: "done" }, actor)).rejects.toMatchObject({
      code: "criteria_open",
    })
    for (const c of (await getIssue(db, "PLAT-1")).criteria) {
      await updateCriterion(db, "PLAT-1", c.id, { checked: true }, actor)
    }
    await moveIssue(db, "PLAT-1", { status: "done" }, actor)
    expect((await getIssue(db, "PLAT-1")).doneAt).toBeInstanceOf(Date)
  })

  test("any column can go to Descartada, which leaves the board", async () => {
    await create("Desperdício")
    await moveIssue(db, "PLAT-1", { status: "discarded" }, actor)
    expect(Object.values((await board(db, "PLAT")).columns).flat()).toEqual([])
  })
})

describe("ordering", () => {
  test("before/after place the card between neighbours, using byte order", async () => {
    for (const title of ["A", "B", "C"]) {
      await create(title, ["ok"])
    }
    // Ideia order is newest first: PLAT-3, PLAT-2, PLAT-1. Moves without neighbours append.
    for (const ref of ["PLAT-3", "PLAT-2", "PLAT-1"]) await moveIssue(db, ref, { status: "ready" }, actor)
    expect(await columnRefs("ready")).toEqual(["PLAT-3", "PLAT-2", "PLAT-1"])

    await moveIssue(db, "PLAT-1", { status: "ready", before: "PLAT-3" }, actor)
    expect(await columnRefs("ready")).toEqual(["PLAT-1", "PLAT-3", "PLAT-2"])
    await moveIssue(db, "PLAT-2", { status: "ready", after: "PLAT-1" }, actor)
    expect(await columnRefs("ready")).toEqual(["PLAT-1", "PLAT-2", "PLAT-3"])
    // Many inserts at the same spot produce mixed-case keys; they must still sort correctly.
    for (let i = 0; i < 30; i++) {
      await moveIssue(db, i % 2 ? "PLAT-3" : "PLAT-2", { status: "ready", before: "PLAT-1" }, actor)
      await moveIssue(db, "PLAT-1", { status: "ready", before: i % 2 ? "PLAT-3" : "PLAT-2" }, actor)
    }
    expect((await columnRefs("ready"))[0]).toBe("PLAT-1")
    // Alpine's Postgres compares bytewise anyway, so also pin the column collation (glibc builds do not).
    const [column] = await db.execute<{ collation_name: string }>(
      sql`select collation_name from information_schema.columns where table_name = 'issues' and column_name = 'position'`,
    )
    expect(column?.collation_name).toBe("C")
  })

  test("neighbours from another column are rejected", async () => {
    await create("A", ["ok"])
    await create("B", ["ok"])
    await moveIssue(db, "PLAT-1", { status: "ready" }, actor)
    await expect(
      moveIssue(db, "PLAT-2", { status: "review", before: "PLAT-1" }, actor),
    ).rejects.toMatchObject({
      code: "invalid_position",
    })
  })
})

describe("criteria", () => {
  test("board counts criteria and edits are logged", async () => {
    await create("Com critérios", ["Um", "Dois"])
    const [first] = (await getIssue(db, "PLAT-1")).criteria
    await updateCriterion(
      db,
      "PLAT-1",
      first?.id ?? 0,
      { checked: true, testRef: "src/a.test.ts:works" },
      actor,
    )
    expect((await board(db, "PLAT")).columns.idea).toMatchObject([{ criteriaTotal: 2, criteriaChecked: 1 }])
    expect((await events("PLAT-1")).at(-1)).toMatchObject({
      kind: "criteria_changed",
      data: { action: "checked" },
    })
  })

  test("the last criterion cannot be removed once the issue left Ideia", async () => {
    await create("Pronta", ["Único"])
    await moveIssue(db, "PLAT-1", { status: "ready" }, actor)
    const [only] = (await getIssue(db, "PLAT-1")).criteria
    await expect(deleteCriterion(db, "PLAT-1", only?.id ?? 0, actor)).rejects.toMatchObject({
      code: "criteria_required",
    })
    await moveIssue(db, "PLAT-1", { status: "idea" }, actor)
    await deleteCriterion(db, "PLAT-1", only?.id ?? 0, actor)
    expect((await getIssue(db, "PLAT-1")).criteria).toEqual([])
  })

  test("criteria of another issue are not reachable through this ref", async () => {
    await create("A", ["de A"])
    await create("B", ["de B"])
    const [ofB] = (await getIssue(db, "PLAT-2")).criteria
    await expect(updateCriterion(db, "PLAT-1", ofB?.id ?? 0, { checked: true }, actor)).rejects.toMatchObject(
      {
        status: 404,
      },
    )
  })
})

describe("wip limits", () => {
  const fill = async (n: number, status: "in_progress" | "review") => {
    for (let i = 0; i < n; i++) {
      const issue = await create(`${status} ${i}`, ["ok"])
      await moveIssue(db, issue.ref, { status }, actor)
    }
  }

  test("a full column refuses new cards with 409 wip_limit but allows reordering inside it", async () => {
    await fill(2, "review")
    const extra = await create("Extra", ["ok"])
    await expect(moveIssue(db, extra.ref, { status: "review" }, actor)).rejects.toMatchObject({
      status: 409,
      code: "wip_limit",
    })
    await moveIssue(db, "PLAT-2", { status: "review", before: "PLAT-1" }, actor)
    expect(await columnRefs("review")).toEqual(["PLAT-2", "PLAT-1"])
  })

  test("a full Revisão blocks pulling more work into Em execução", async () => {
    await fill(2, "review")
    const next = await create("Próxima", ["ok"])
    await moveIssue(db, next.ref, { status: "ready" }, actor)
    await expect(moveIssue(db, next.ref, { status: "in_progress" }, actor)).rejects.toMatchObject({
      status: 409,
      code: "wip_limit",
      message: expect.stringContaining("Revisão"),
    })
  })

  test("rejecting from Revisão is never blocked, even with Em execução full", async () => {
    await fill(3, "in_progress")
    await fill(1, "review")
    await moveIssue(db, "PLAT-4", { status: "in_progress", note: "Refazer" }, actor)
    expect(await columnRefs("in_progress")).toHaveLength(4)
  })

  test("limits are configurable per project and can be removed", async () => {
    await updateProject(db, "PLAT", { wipLimits: { in_progress: 1, review: null } })
    await fill(1, "in_progress")
    const second = await create("Segunda", ["ok"])
    await expect(moveIssue(db, second.ref, { status: "in_progress" }, actor)).rejects.toMatchObject({
      code: "wip_limit",
    })
    await fill(5, "review")
    expect(await columnRefs("review")).toHaveLength(5)
  })
})

describe("issue panel", () => {
  test("edits fields and logs which ones changed", async () => {
    await create("Antigo")
    const updated = await updateIssue(
      db,
      "PLAT-1",
      issuePatch.parse({ title: " Novo ", description: "## Problema", contextFiles: ["src/a.ts", " "] }),
      actor,
    )
    expect(updated).toMatchObject({ title: "Novo", description: "## Problema", contextFiles: ["src/a.ts"] })
    expect((await events("PLAT-1")).at(-1)).toMatchObject({
      kind: "edited",
      data: { fields: ["title", "description", "contextFiles"] },
    })
    expect(issuePatch.safeParse({ title: "" }).success).toBe(false)
  })

  test("detail brings criteria, comments and events with names, in at most 3 queries", async () => {
    await create("Com histórico", ["Um"])
    await addComment(db, "PLAT-1", "Primeiro **comentário**", actor)
    await moveIssue(db, "PLAT-1", { status: "ready" }, actor)
    let queries = 0
    const counted = drizzle(db.$client, { schema, logger: { logQuery: () => queries++ } })
    const issue = await getIssue(counted, "PLAT-1")
    expect(queries).toBeLessThanOrEqual(3)
    expect(issue.criteria).toMatchObject([{ text: "Um" }])
    expect(issue.comments).toMatchObject([{ body: "Primeiro **comentário**", author: { name: "Ana" } }])
    expect(issue.events.map((e) => e.kind)).toEqual(["created", "moved"])
    expect(issue.events[1]).toMatchObject({ actor: { name: "Ana" }, data: { from: "idea", to: "ready" } })
  })

  test("comments must have content", async () => {
    await create("Comentável")
    await expect(addComment(db, "PLAT-1", "   ", actor)).rejects.toMatchObject({ status: 422 })
  })
})

describe("pull requests", () => {
  test("links a branch and a PR, parsing its number, and logs it", async () => {
    await create("Com PR")
    const linked = await linkPr(
      db,
      "PLAT-1",
      prInput.parse({ branch: "plat-1-com-pr", pr_url: "https://github.com/acme/app/pull/42" }),
      actor,
    )
    expect(linked).toMatchObject({ branch: "plat-1-com-pr", prNumber: 42, prState: "open" })
    expect((await events("PLAT-1")).at(-1)).toMatchObject({
      kind: "pr_linked",
      data: { branch: "plat-1-com-pr" },
    })
    expect(prInput.safeParse({}).success).toBe(false)
    expect(prInput.safeParse({ branch: "bad branch" }).success).toBe(false)
    expect(prInput.safeParse({ pr_url: "javascript:alert(1)" }).success).toBe(false)
  })
})
