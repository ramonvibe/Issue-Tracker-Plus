import { expect, test } from "@playwright/test"

const admin = { name: "Ana", email: "ana@example.com", password: "senha-segura-123" }

test.describe
  .serial("skeleton", () => {
    test("first visit sets up the admin, creates a project and shows the empty board", async ({ page }) => {
      await page.goto("/")
      await expect(page).toHaveURL(/\/login$/)
      await page.getByLabel("Nome").fill(admin.name)
      await page.getByLabel("Email").fill(admin.email)
      await page.getByLabel("Senha").fill(admin.password)
      await page.getByRole("button", { name: "Criar e entrar" }).click()

      await expect(page.getByRole("heading", { name: "Projetos" })).toBeVisible()
      await page.getByLabel("Chave").fill("plat")
      await page.getByLabel("Nome").fill("Plataforma")
      await page.getByRole("button", { name: "Criar projeto" }).click()
      await page.getByRole("link", { name: /PLAT\s+Plataforma/ }).click()

      await expect(page).toHaveURL(/\/PLAT$/)
      for (const column of ["Ideia", "Pronta", "Em execução", "Revisão", "Concluída"]) {
        await expect(page.getByRole("region", { name: new RegExp(`^${column}`) })).toBeVisible()
      }
      await expect(page.getByRole("region", { name: /^Revisão/ })).toContainText("0 de 2")
    })

    test("login rejects a wrong password and accepts the right one; deep links survive reload", async ({
      page,
    }) => {
      await page.goto("/PLAT")
      await expect(page).toHaveURL(/\/login$/)
      await page.getByLabel("Email").fill(admin.email)
      await page.getByLabel("Senha").fill("senha-errada-123")
      await page.getByRole("button", { name: "Entrar" }).click()
      await expect(page.getByRole("alert")).toHaveText("Email ou senha inválidos")

      await page.getByLabel("Senha").fill(admin.password)
      await page.getByRole("button", { name: "Entrar" }).click()
      await expect(page.getByRole("heading", { name: "Projetos" })).toBeVisible()
      await page.goto("/PLAT")
      await expect(page.getByRole("heading", { name: /PLAT\s+Plataforma/ })).toBeVisible()
    })
  })
