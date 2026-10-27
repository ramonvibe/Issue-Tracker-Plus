import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { api, unwrap } from "./api.ts"
import { Button, ErrorText, Field } from "./ui.tsx"

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => unwrap(api.projects.$get()) })
  const create = useMutation({
    mutationFn: (json: { key: string; name: string }) => unwrap(api.projects.$post({ json })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })

  return (
    <main className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <h1 className="text-xl font-semibold">Projetos</h1>
      <ul className="grid gap-2">
        {projects.data?.map((p) => (
          <li key={p.id}>
            <Link
              to="/$key"
              params={{ key: p.key }}
              className="flex items-baseline gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
            >
              <span className="font-mono text-sm text-muted">{p.key}</span>
              <span className="font-medium">{p.name}</span>
            </Link>
          </li>
        ))}
        {projects.data?.length === 0 && <li className="text-sm text-muted">Nenhum projeto ainda.</li>}
      </ul>
      <form
        className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          const data = new FormData(form)
          create.mutate(
            { key: String(data.get("key")), name: String(data.get("name")) },
            { onSuccess: () => form.reset() },
          )
        }}
      >
        <Field label="Chave" name="key" required placeholder="PLAT" className="uppercase" />
        <Field label="Nome" name="name" required placeholder="Plataforma" />
        <Button type="submit" disabled={create.isPending}>
          Criar projeto
        </Button>
        <div className="sm:col-span-3">
          <ErrorText error={create.error} />
        </div>
      </form>
    </main>
  )
}
