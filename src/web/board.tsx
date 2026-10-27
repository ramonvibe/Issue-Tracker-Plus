import { useQuery } from "@tanstack/react-query"
import { useParams } from "@tanstack/react-router"
import { api, unwrap } from "./api.ts"
import { ErrorText } from "./ui.tsx"

const COLUMNS = [
  { status: "idea", title: "Ideia" },
  { status: "ready", title: "Pronta" },
  { status: "in_progress", title: "Em execução" },
  { status: "review", title: "Revisão" },
  { status: "done", title: "Concluída" },
] as const

export function BoardPage() {
  const { key } = useParams({ from: "/authed/$key" })
  const board = useQuery({
    queryKey: ["board", key],
    queryFn: () => unwrap(api.projects[":key"].board.$get({ param: { key } })),
  })
  if (!board.data) return <ErrorText error={board.error} />
  const { project, columns } = board.data

  return (
    <main className="grid gap-4 px-4 py-4">
      <h1 className="text-lg font-semibold">
        <span className="font-mono text-muted">{project.key}</span> {project.name}
      </h1>
      <div className="grid gap-3 md:grid-cols-5">
        {COLUMNS.map(({ status, title }) => {
          const count = columns[status].length
          const limit =
            status === "in_progress" || status === "review" ? project.wipLimits[status] : undefined
          return (
            <section
              key={status}
              aria-labelledby={`col-${status}`}
              className="grid content-start gap-2 rounded-lg border border-border bg-surface p-2"
            >
              <h2 id={`col-${status}`} className="flex items-center justify-between px-1 text-sm font-medium">
                {title}
                <span className="text-xs text-muted">
                  <span aria-hidden="true">{limit ? `${count}/${limit}` : count}</span>
                  <span className="sr-only">{limit ? `${count} de ${limit}` : `${count} issues`}</span>
                </span>
              </h2>
              <ul className="grid min-h-16 gap-2">
                {count === 0 && <li className="px-1 text-xs text-muted">Vazia</li>}
              </ul>
            </section>
          )
        })}
      </div>
    </main>
  )
}
