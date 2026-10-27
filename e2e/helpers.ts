import type { Page } from "@playwright/test"

export const admin = { name: "Ana", email: "ana@example.com", password: "senha-segura-123" }

// Signs in through the API (creating the admin on a fresh database) and ensures the project exists.
export async function signInWithProject(page: Page, key: string) {
  const setup = await page.request.post("/api/setup", { data: admin })
  if (setup.status() === 409) await page.request.post("/api/session", { data: admin })
  await page.request.post("/api/projects", { data: { key, name: `Projeto ${key}` } })
}
