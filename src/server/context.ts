type ContextIssue = {
  ref: string
  title: string
  description: string
  contextFiles: string[]
  branch: string | null
  criteria: { text: string; testRef: string | null; checked: boolean }[]
}

export function branchName(ref: string, title: string) {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${ref.toLowerCase()}-${slug}`.slice(0, 50).replace(/-$/, "")
}

// The self-contained prompt an agent runs without asking anything (format fixed by the spec).
export function issueContext(issue: ContextIssue, baseUrl: string) {
  const { ref } = issue
  const criteria = issue.criteria.map(
    (c) => `- [${c.checked ? "x" : " "}] ${c.text}${c.testRef ? ` (teste: ${c.testRef})` : ""}`,
  )
  const files = issue.contextFiles.map((f) => `- ${f}`)
  return `# ${ref}: ${issue.title}

## Problema

${issue.description.trim() || "_Sem descrição._"}

## Critérios de aceite

${criteria.join("\n") || "_Nenhum critério._"}

## Arquivos relevantes

${files.join("\n") || "_Nenhum listado._"}

## Como trabalhar

Branch: ${issue.branch ?? branchName(ref, issue.title)}. Escreva primeiro um teste que falhe para cada critério, implemente o mínimo para passar e refatore. Commits pequenos citando ${ref}. Ao terminar, abra PR citando ${ref} e mova a issue para review via API.

API (header \`Authorization: Bearer <token>\`):

- Mover: \`POST ${baseUrl}/api/issues/${ref}/move\` com \`{"status":"in_progress"}\` ao começar e \`{"status":"review"}\` ao terminar
- Vincular PR: \`PUT ${baseUrl}/api/issues/${ref}/pr\` com \`{"branch":"...","pr_url":"..."}\`
`
}
