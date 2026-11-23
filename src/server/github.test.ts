import { createHmac } from "node:crypto"
import { eq } from "drizzle-orm"
import { beforeEach, describe, expect, test } from "vitest"
import { createUser } from "./auth.ts"
import { handleWebhook, references, verifySignature } from "./github.ts"
import { createIssue, getIssue, moveIssue } from "./issues.ts"
import { createProject, updateProject } from "./projects.ts"
import { issueEvents } from "./schema.ts"
import { db } from "./test/db.ts"

let actor: { userId: number }
let delivery = 0

beforeEach(async () => {
  actor = { userId: (await createUser(db, { name: "Ana", email: "a@x.com", password: "senha-segura-123", role: "admin" })).id }
  await createProject(db, { key: "PLAT", name: "Plataforma", repoFullName: "acme/app" })
})

const issue = async (status?: "ready" | "in_progress") => {
  const created = await createIssue(db, "PLAT", { title: "x", description: "", contextFiles: [], criteria: [{ text: "ok" }] }, actor)
  if (status) await moveIssue(db, created.ref, { status }, actor)
  return created.ref
}
const pr = (action: string, fields: Record<string, unknown> = {}, repo = "acme/app") => ({
  action,
  repository: { full_name: repo },
  pull_request: {
    number: 7,
    title: "PLAT-1: exportar contexto",
    body: "",
    html_url: "https://github.com/acme/app/pull/7",
    state: "open",
    merged: false,
    draft: false,
    head: { ref: "feature" },
    ...fields,
  },
})
const send = (event: string, payload: unknown) => handleWebhook(db, `d-${++delivery}`, event, payload)
const kinds = async (ref: string) =>
  (await db.select().from(issueEvents).where(eq(issueEvents.issueId, (await getIssue(db, ref)).id))).map((e) => e.kind)

describe("references", () => {
  test("only the linked key, with word boundaries; branches may be lowercase", () => {
    expect(references("PLAT-1 e PLAT-22, não XPLAT-3 nem PLAT-0 nem OTHER-4", "PLAT")).toEqual([1, 22])
    expect(references("fix plat-9", "PLAT")).toEqual([])
    expect(references("plat-9-slug", "PLAT", { ignoreCase: true })).toEqual([9])
  })
})

describe("signature", () => {
  test("accepts only the exact HMAC-SHA256 of the body", () => {
    const secret = "s".repeat(32)
    const body = '{"a":1}'
    const good = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
    expect(verifySignature(secret, good, body)).toBe(true)
    expect(verifySignature(secret, good, `${body} `)).toBe(false)
    expect(verifySignature(secret, "sha256=00", body)).toBe(false)
    expect(verifySignature(secret, undefined, body)).toBe(false)
  })
})

describe("webhook", () => {
  test("an opened PR links to the issue and moves it to Revisão", async () => {
    await issue("in_progress")
    expect(await send("pull_request", pr("opened"))).toBe("processed")
    expect(await getIssue(db, "PLAT-1")).toMatchObject({
      status: "review",
      prNumber: 7,
      prState: "open",
      prUrl: "https://github.com/acme/app/pull/7",
      branch: "feature",
    })
    expect(await kinds("PLAT-1")).toEqual(["created", "moved", "pr_linked", "moved"])
  })

  test("a full Revisão keeps the issue where it is and says why", async () => {
    await updateProject(db, "PLAT", { wipLimits: { review: 1 } })
    await issue("in_progress")
    const other = await issue("in_progress")
    await moveIssue(db, other, { status: "review" }, actor)
    await send("pull_request", pr("opened"))
    const detail = await getIssue(db, "PLAT-1")
    expect(detail.status).toBe("in_progress")
    expect(detail.events.at(-1)).toMatchObject({ kind: "auto_move_skipped", data: { reason: "wip_limit" } })
  })

  test("a draft or an issue still in Ideia is linked but not moved", async () => {
    await issue()
    await send("pull_request", pr("opened", { draft: true }))
    expect((await getIssue(db, "PLAT-1")).status).toBe("idea")
    expect((await getIssue(db, "PLAT-1")).prNumber).toBe(7)
  })

  test("merging records it but leaves Concluída to the human, via the criteria", async () => {
    await issue("in_progress")
    await send("pull_request", pr("opened"))
    await send("pull_request", pr("closed", { state: "closed", merged: true }))
    expect(await getIssue(db, "PLAT-1")).toMatchObject({ status: "review", prState: "merged" })
    expect((await kinds("PLAT-1")).at(-1)).toBe("pr_merged")
  })

  test("the branch name links too, lowercase included", async () => {
    await issue("in_progress")
    await send("pull_request", pr("opened", { title: "sem referência", head: { ref: "plat-1-exportar" } }))
    expect((await getIssue(db, "PLAT-1")).status).toBe("review")
  })

  test("push links commits as events", async () => {
    await issue()
    await send("push", {
      repository: { full_name: "acme/app" },
      commits: [
        { id: "abc123", message: "feat: contexto PLAT-1\n\ndetalhes", url: "https://github.com/acme/app/commit/abc123" },
        { id: "def456", message: "chore: nada", url: "u" },
      ],
    })
    const detail = await getIssue(db, "PLAT-1")
    expect(detail.events.at(-1)).toMatchObject({
      kind: "commit",
      data: { sha: "abc123", message: "feat: contexto PLAT-1", url: "https://github.com/acme/app/commit/abc123" },
    })
  })

  test("repeated deliveries and unknown repositories are ignored", async () => {
    await issue("in_progress")
    expect(await handleWebhook(db, "same", "pull_request", pr("opened"))).toBe("processed")
    expect(await handleWebhook(db, "same", "pull_request", pr("opened"))).toBe("duplicate")
    expect(await send("pull_request", pr("opened", {}, "evil/repo"))).toBe("ignored")
    expect((await kinds("PLAT-1")).filter((k) => k === "pr_linked")).toHaveLength(1)
  })
})
