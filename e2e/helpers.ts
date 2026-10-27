import type { Page } from "@playwright/test"

export const admin = { name: "Ana", email: "ana@example.com", password: "senha-segura-123" }

// Signs in through the API (creating the admin on a fresh database) and creates a project with a
// unique key, so tests stay independent and can be repeated against the same database.
export async function signInWithProject(page: Page, prefix: string) {
  const setup = await page.request.post("/api/setup", { data: admin })
  if (setup.status() === 409) await page.request.post("/api/session", { data: admin })
  const key = `${prefix}${Math.random().toString(36).slice(2, 6).toUpperCase()}`
  await page.request.post("/api/projects", { data: { key, name: `Projeto ${prefix}` } })
  return key
}
