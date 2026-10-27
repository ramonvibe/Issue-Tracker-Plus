import { describe, expect, test } from "vitest"
import { branchName, issueContext } from "./context.ts"

const issue = {
  ref: "PLAT-142",
  title: "Exportar contexto em Markdown (rápido!)",
  description: "Agentes precisam de **contexto**.",
  contextFiles: ["src/server/context.ts", "src/web/board.tsx"],
  branch: null,
  criteria: [
    { text: "Contém título e critérios", testRef: "src/server/context.test.ts:formats", checked: false },
    { text: "Botão copia", testRef: null, checked: true },
  ],
}

describe("context export", () => {
  test("branch names are lowercase ascii slugs", () => {
    expect(branchName("PLAT-142", "Exportar contexto em Markdown (rápido!)")).toBe(
      "plat-142-exportar-contexto-em-markdown-rapido",
    )
    expect(branchName("A1-2", "x".repeat(80)).length).toBeLessThanOrEqual(50)
  })

  test("follows the documented format", () => {
    expect(
      issueContext(issue, "https://tracker.example"),
    ).toBe(`# PLAT-142: Exportar contexto em Markdown (rápido!)

## Problema

Agentes precisam de **contexto**.

## Critérios de aceite

- [ ] Contém título e critérios (teste: src/server/context.test.ts:formats)
- [x] Botão copia

## Arquivos relevantes

- src/server/context.ts
- src/web/board.tsx

## Como trabalhar

Branch: plat-142-exportar-contexto-em-markdown-rapido. Escreva primeiro um teste que falhe para cada critério, implemente o mínimo para passar e refatore. Commits pequenos citando PLAT-142. Ao terminar, abra PR citando PLAT-142 e mova a issue para review via API.

API (header \`Authorization: Bearer <token>\`):

- Mover: \`POST https://tracker.example/api/issues/PLAT-142/move\` com \`{"status":"in_progress"}\` ao começar e \`{"status":"review"}\` ao terminar
- Vincular PR: \`PUT https://tracker.example/api/issues/PLAT-142/pr\` com \`{"branch":"...","pr_url":"..."}\`
`)
  })

  test("says so when sections are empty and keeps a linked branch", () => {
    const text = issueContext({ ...issue, description: "", contextFiles: [], branch: "feat/x" }, "http://x")
    expect(text).toContain("## Problema\n\n_Sem descrição._")
    expect(text).toContain("## Arquivos relevantes\n\n_Nenhum listado._")
    expect(text).toContain("Branch: feat/x.")
  })
})
