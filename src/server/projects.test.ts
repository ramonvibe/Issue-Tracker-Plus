import { describe, expect, test } from "vitest"
import { createProject, getProject, listProjects, projectInput } from "./projects.ts"
import { db } from "./test/db.ts"

describe("projects", () => {
  test("normalizes the key and starts with default WIP limits", async () => {
    const project = await createProject(db, projectInput.parse({ key: " plat ", name: "Plataforma" }))
    expect(project).toMatchObject({
      key: "PLAT",
      nextIssueNumber: 1,
      wipLimits: { in_progress: 3, review: 2 },
    })
    expect((await listProjects(db)).map((p) => p.key)).toEqual(["PLAT"])
  })

  test("validates the key format", () => {
    for (const key of ["P", "1PLAT", "PLAT-1", "ABCDEFGHIJK"]) {
      expect(projectInput.safeParse({ key, name: "x" }).success).toBe(false)
    }
  })

  test("rejects a duplicate key and reports missing projects", async () => {
    await createProject(db, { key: "PLAT", name: "Plataforma" })
    await expect(createProject(db, { key: "PLAT", name: "Outra" })).rejects.toMatchObject({
      code: "key_taken",
    })
    await expect(getProject(db, "NOPE")).rejects.toMatchObject({ status: 404, code: "not_found" })
  })
})
