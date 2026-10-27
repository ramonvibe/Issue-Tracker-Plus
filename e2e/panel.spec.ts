import { expect, test } from "@playwright/test"
import { signInWithProject } from "./helpers.ts"

test("panel: edit with e, render Markdown, comment and see the activity", async ({ page }) => {
  const key = await signInWithProject(page, "PANEL")
  await page.request.post(`/api/projects/${key}/issues`, { data: { title: "Título antigo" } })
  await page.goto(`/${key}`)
  await page.locator(`[data-ref=${key}-1]`).focus()
  await page.keyboard.press("e")

  await expect(page).toHaveURL(new RegExp(`/${key}-1$`))
  const title = page.getByLabel("Título")
  await expect(title).toBeFocused()
  await title.fill("Exportar contexto")
  await page.getByLabel("Problema (Markdown)").fill("Agentes precisam de **contexto** completo.")
  await page.getByLabel("Arquivos relevantes (um por linha)").fill("src/server/context.ts\nsrc/web/board.tsx")
  await page.getByLabel("Arquivos relevantes (um por linha)").press("Control+Enter")

  const panel = page.getByRole("complementary", { name: `Issue ${key}-1` })
  await expect(panel.getByRole("heading", { name: "Exportar contexto" })).toBeVisible()
  await expect(panel.locator(".md strong")).toHaveText("contexto")
  await expect(panel.getByText("src/web/board.tsx")).toBeVisible()
  await expect(page.locator(`[data-ref=${key}-1]`)).toContainText("Exportar contexto")

  const comment = page.getByLabel("Novo comentário")
  await comment.fill("Ver o `README` antes")
  await comment.press("Control+Enter")
  await expect(panel.locator("li .md code")).toHaveText("README")
  await expect(panel.getByText(/editou o título, a descrição, os arquivos relevantes/)).toBeVisible()

  // Esc while editing only cancels the edit; Esc again closes the panel.
  await panel.getByRole("heading", { name: "Exportar contexto" }).focus()
  await page.keyboard.press("e")
  await expect(page.getByLabel("Título")).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(panel.getByRole("heading", { name: "Exportar contexto" })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(new RegExp(`/${key}$`))
})
