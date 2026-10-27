import { expect, type Page, test } from "@playwright/test"
import { signInWithProject } from "./helpers.ts"

const column = (page: Page, name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) })

async function seed(page: Page, prefix: string, issues: { title: string; status?: string }[]) {
  const key = await signInWithProject(page, prefix)
  for (const { title, status } of issues) {
    const res = await page.request.post(`/api/projects/${key}/issues`, {
      data: { title, criteria: [{ text: "ok" }] },
    })
    const { ref } = (await res.json()) as { ref: string }
    if (status) await page.request.post(`/api/issues/${ref}/move`, { data: { status } })
  }
  return key
}

test("moves show instantly and roll back with an explanation when the WIP limit refuses them", async ({
  page,
}) => {
  const key = await seed(page, "WIP", [{ title: "Em revisão", status: "review" }, { title: "Candidata" }])
  await page.request.patch(`/api/projects/${key}`, { data: { wipLimits: { review: 1 } } })
  // A slow server proves the board does not wait for it.
  await page.route("**/api/issues/*/move", async (route) => {
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.goto(`/${key}`)
  await expect(page.getByText("Revisão cheia (1/1)")).toBeVisible()
  await expect(column(page, "Revisão")).toContainText("1/1")

  const candidate = `[data-ref=${key}-2]`
  await page.locator(candidate).focus()
  await page.keyboard.press("4")
  await expect(column(page, "Revisão").locator(candidate)).toBeVisible({ timeout: 300 })

  await expect(page.getByRole("alert")).toContainText("Revisão está no limite de WIP (1/1)")
  await expect(column(page, "Ideia").locator(candidate)).toBeVisible()
  await expect(page.locator(candidate)).toBeFocused()
})

test("drag and drop reorders inside a column and moves across columns, and it sticks", async ({ page }) => {
  const key = await seed(page, "DRAG", [
    { title: "Primeira", status: "ready" },
    { title: "Segunda", status: "ready" },
  ])
  const [one, two] = [`${key}-1`, `${key}-2`]
  await page.goto(`/${key}`)
  const ready = column(page, "Pronta")
  await expect(ready.getByRole("link")).toHaveText([new RegExp(one), new RegExp(two)])

  const drag = async (from: string, to: { x: number; y: number }) => {
    const box = await page.locator(`[data-ref=${from}]`).boundingBox()
    if (!box) throw new Error(`${from} not on screen`)
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10, { steps: 3 })
    await page.mouse.move(to.x, to.y, { steps: 12 })
    await page.mouse.up()
  }
  const first = await page.locator(`[data-ref=${one}]`).boundingBox()
  if (!first) throw new Error("first card not on screen")
  await drag(two, { x: first.x + first.width / 2, y: first.y + 4 })
  await expect(ready.getByRole("link")).toHaveText([new RegExp(two), new RegExp(one)])
  await expect(page).toHaveURL(new RegExp(`/${key}$`))

  const target = await column(page, "Em execução").boundingBox()
  if (!target) throw new Error("column not on screen")
  await drag(one, { x: target.x + target.width / 2, y: target.y + 120 })
  await expect(column(page, "Em execução").getByRole("link")).toHaveText([new RegExp(one)])

  await page.reload()
  await expect(ready.getByRole("link")).toHaveText([new RegExp(two)])
  await expect(column(page, "Em execução").getByRole("link")).toHaveText([new RegExp(one)])
})
