import { expect, test } from "@playwright/test"
import { signInWithProject } from "./helpers.ts"

test.use({ permissions: ["clipboard-read", "clipboard-write"] })

// MVP acceptance criterion 1: the whole flow without the mouse, ending with `x`.
test("create with c, define the contract, move to Pronta and copy the context with x", async ({ page }) => {
  const key = await signInWithProject(page, "CTX")
  const ref = `${key}-1`
  await page.goto(`/${key}`)
  await expect(page.getByRole("region", { name: /^Ideia/ })).toBeVisible()

  await page.keyboard.press("c")
  await page.keyboard.type("Exportar contexto")
  await page.keyboard.press("Enter")
  await page.keyboard.press("Escape")
  await page.keyboard.press("j")
  await expect(page.locator(`[data-ref=${ref}]`)).toBeFocused()

  await page.keyboard.press("e")
  await page.getByLabel("Problema (Markdown)").focus()
  await page.keyboard.type("O agente precisa do contrato inteiro.")
  await page.getByLabel("Arquivos relevantes (um por linha)").focus()
  await page.keyboard.type("src/server/context.ts")
  await page.keyboard.press("Control+Enter")
  for (const text of ["Markdown contém os critérios", "Botão copia o texto"]) {
    await page.getByLabel("Novo critério de aceite").focus()
    await page.keyboard.type(text)
    await page.keyboard.press("Enter")
  }
  await expect(page.getByRole("checkbox")).toHaveCount(2)
  await page.keyboard.press("Escape")
  await expect(page.locator(`[data-ref=${ref}]`)).toBeFocused()
  await page.keyboard.press("l")
  await expect(page.getByRole("region", { name: /^Pronta/ }).locator(`[data-ref=${ref}]`)).toBeVisible()

  await page.keyboard.press("x")
  await expect(page.getByRole("status").filter({ hasText: `Contexto de ${ref} copiado` })).toBeVisible()
  const markdown = await page.evaluate(() => navigator.clipboard.readText())
  expect(markdown).toContain(`# ${ref}: Exportar contexto`)
  expect(markdown).toContain("## Problema\n\nO agente precisa do contrato inteiro.")
  expect(markdown).toContain("- [ ] Markdown contém os critérios\n- [ ] Botão copia o texto")
  expect(markdown).toContain("## Arquivos relevantes\n\n- src/server/context.ts")
  expect(markdown).toContain(`Branch: ${ref.toLowerCase()}-exportar-contexto.`)
  expect(markdown).toContain("Escreva primeiro um teste que falhe")
})

test("API tokens: created once, listed without the secret, revocable", async ({ page }) => {
  await signInWithProject(page, "TOK")
  await page.goto("/tokens")
  await page.getByLabel("Nome do token").fill("claude-e2e")
  await page.getByRole("button", { name: "Criar token" }).click()
  const secret = await page.getByLabel("Token criado").inputValue()
  expect(secret).toMatch(/^mf_/)
  const me = await page.request.get("/api/me", { headers: { authorization: `Bearer ${secret}` } })
  expect(me.ok()).toBe(true)

  await page.getByRole("button", { name: "Revogar token claude-e2e" }).click()
  await expect(page.getByText("revogado").first()).toBeVisible()
  const after = await page.request.get("/api/me", {
    headers: { authorization: `Bearer ${secret}`, cookie: "" },
  })
  expect(after.status()).toBe(401)
})
