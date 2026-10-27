// Seeds a throwaway database and captures the main screens (light/dark, desktop/mobile) for visual review.
// Usage: pnpm build && node scripts/screenshots.ts [outDir]
import { spawn } from "node:child_process"
import { chromium } from "@playwright/test"
import { recreateDatabase } from "../src/server/test/global-setup.ts"

const port = 8091
const base = `http://localhost:${port}`
const databaseUrl = "postgres://makeit:makeit@127.0.0.1:5433/makeit_shots"
const outDir = process.argv[2] ?? "screenshots"

await recreateDatabase(databaseUrl)
const server = spawn("node", ["src/server/index.ts"], {
  env: { ...process.env, PORT: String(port), DATABASE_URL: databaseUrl },
  stdio: "inherit",
})
try {
  for (let i = 0; i < 50 && !(await fetch(`${base}/healthz`).catch(() => null))?.ok; i++) {
    await new Promise((r) => setTimeout(r, 200))
  }
  const browser = await chromium.launch()
  const seed = await browser.newContext({ baseURL: base })
  const api = seed.request
  await api.post("/api/setup", {
    data: { name: "Ana", email: "ana@example.com", password: "senha-segura-123" },
  })
  await api.post("/api/projects", { data: { key: "PLAT", name: "Plataforma" } })
  await api.post("/api/projects", { data: { key: "MOB", name: "App mobile" } })
  const issues: [string, string[], string][] = [
    ["Exportar contexto em Markdown", ["Contém título e critérios", "Botão copia"], "ready"],
    ["Webhook do GitHub vincula PR", ["Assinatura inválida retorna 401"], "in_progress"],
    ["Paleta de comandos com Ctrl+K", ["Busca por referência"], "review"],
    ["Métricas de lead time", ["Mediana e p85"], "review"],
    ["Tokens de API por usuário", ["Revogar token"], "done"],
    ["Tema escuro", [], "idea"],
    ["Importar dados do 1984 com um título bem mais comprido para ver a quebra de linha", [], "idea"],
  ]
  for (const [title, criteria, status] of issues) {
    const res = await api.post("/api/projects/PLAT/issues", {
      data: { title, criteria: criteria.map((text) => ({ text })) },
    })
    const { ref } = (await res.json()) as { ref: string }
    if (status === "done") {
      const detail = (await (await api.get(`/api/issues/${ref}`)).json()) as { criteria: { id: number }[] }
      for (const c of detail.criteria)
        await api.patch(`/api/issues/${ref}/criteria/${c.id}`, { data: { checked: true } })
    }
    if (status !== "idea") await api.post(`/api/issues/${ref}/move`, { data: { status } })
  }
  const state = await seed.storageState()

  for (const colorScheme of ["light", "dark"] as const) {
    for (const [device, viewport] of [
      ["desktop", { width: 1440, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      const shot = async (name: string, path: string, authed = true) => {
        const ctx = await browser.newContext({
          baseURL: base,
          colorScheme,
          viewport,
          storageState: authed ? state : undefined,
        })
        const page = await ctx.newPage()
        await page.goto(path)
        await page.waitForLoadState("networkidle")
        await page.waitForTimeout(400)
        await page.screenshot({ path: `${outDir}/${name}-${device}-${colorScheme}.png`, fullPage: true })
        await ctx.close()
      }
      await shot("login", "/login", false)
      await shot("projects", "/")
      await shot("board", "/PLAT")
      await shot("panel", "/PLAT-1")
    }
  }
  await browser.close()
} finally {
  server.kill()
}
