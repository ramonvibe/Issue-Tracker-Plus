import { expect, test } from "@playwright/test"
import { signInWithProject } from "./helpers.ts"

test("capture, define criteria and move through the board without the mouse", async ({ page }) => {
  await signInWithProject(page, "FLOW")
  await page.goto("/FLOW")
  const column = (name: string) => page.getByRole("region", { name: new RegExp(`^${name}`) })
  await expect(column("Ideia")).toBeVisible()

  await page.keyboard.press("c")
  await page.keyboard.type("Exportar contexto")
  await page.keyboard.press("Enter")
  await page.keyboard.type("Segunda ideia")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await expect(column("Ideia").getByRole("link")).toHaveText([
    /FLOW-2\s*Segunda ideia/,
    /FLOW-1\s*Exportar contexto/,
  ])

  // j focuses the first card, j again the next; l without criteria is refused by the server.
  await page.keyboard.press("j")
  await page.keyboard.press("j")
  await expect(page.locator("[data-ref=FLOW-1]")).toBeFocused()
  await page.keyboard.press("l")
  await expect(page.getByRole("alert")).toContainText("critério de aceite")

  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/FLOW-1$/)
  const criterion = page.getByLabel("Novo critério de aceite")
  await criterion.fill("Markdown contém título e critérios")
  await criterion.press("Enter")
  await expect(criterion).toHaveValue("")
  await criterion.fill("Botão copia para a área de transferência")
  await criterion.press("Enter")
  await expect(page.getByRole("checkbox")).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect(page).toHaveURL(/\/FLOW$/)
  await expect(page.locator("[data-ref=FLOW-1]")).toBeFocused()

  await page.keyboard.press("l")
  await expect(column("Pronta").getByRole("link")).toHaveText(/FLOW-1.*0\/2/)
  await expect(page.locator("[data-ref=FLOW-1]")).toBeFocused()
  await page.keyboard.press("4")
  await expect(column("Revisão").getByRole("link")).toHaveText(/FLOW-1/)

  // Rejecting from Revisão asks for a note.
  await page.keyboard.press("h")
  const dialog = page.getByRole("dialog", { name: /Devolver FLOW-1/ })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Nota de rejeição").fill("Faltou o teste do botão")
  await dialog.getByRole("button", { name: "Devolver" }).click()
  await expect(column("Em execução").getByRole("link")).toHaveText(/FLOW-1/)
})
