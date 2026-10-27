import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type CSSProperties, type MouseEvent, useState } from "react"
import { api, unwrap } from "./api.ts"
import { FlowBackground } from "./flow-background.tsx"
import { Button, ErrorText, Field } from "./ui.tsx"

// Tilts the card toward the pointer through CSS vars, so the transform itself stays in the class list.
function tilt(e: MouseEvent<HTMLElement>) {
  const el = e.currentTarget
  // Measure the untransformed parent: the tilted element's own box changes with the tilt and would feed back.
  const rect = (el.parentElement ?? el).getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width - 0.5
  const y = (e.clientY - rect.top) / rect.height - 0.5
  el.style.setProperty("--rx", `${(-y * 8).toFixed(2)}deg`)
  el.style.setProperty("--ry", `${(x * 10).toFixed(2)}deg`)
  el.style.setProperty("--gx", `${((x + 0.5) * 100).toFixed(0)}%`)
  el.style.setProperty("--gy", `${((y + 0.5) * 100).toFixed(0)}%`)
}

function untilt(e: MouseEvent<HTMLElement>) {
  for (const name of ["--rx", "--ry"]) e.currentTarget.style.setProperty(name, "0deg")
}

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const [energy, setEnergy] = useState(1)
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => unwrap(api.projects.$get()) })
  const create = useMutation({
    mutationFn: (json: { key: string; name: string }) => unwrap(api.projects.$post({ json })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  })

  return (
    <main className="relative isolate mx-auto grid max-w-3xl gap-8 px-4 py-10">
      <FlowBackground energy={energy} />
      <div className="grid animate-fade-up gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Projetos</h1>
        <p className="text-sm text-muted">Escolha um quadro ou crie um novo projeto.</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 [perspective:900px]">
        {projects.data?.map((p, i) => (
          <li
            key={p.id}
            className="animate-fade-up"
            style={{ animationDelay: `${i * 40}ms` } as CSSProperties}
          >
            <Link
              to="/$ref"
              params={{ ref: p.key }}
              onMouseMove={tilt}
              onMouseEnter={() => setEnergy(3)}
              onMouseLeave={(e) => {
                untilt(e)
                setEnergy(1)
              }}
              onFocus={() => setEnergy(3)}
              onBlur={() => setEnergy(1)}
              className="group relative grid h-full gap-3 overflow-hidden rounded-2xl border border-border bg-surface/85 p-5 shadow-card backdrop-blur-xl transition-[transform,box-shadow,border-color] duration-200 ease-out [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] [transform-style:preserve-3d] hover:border-accent/50 hover:shadow-float"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 [background:radial-gradient(400px_circle_at_var(--gx,50%)_var(--gy,50%),color-mix(in_srgb,var(--accent)_14%,transparent),transparent_60%)] group-hover:opacity-100"
              />
              <span className="flex items-center justify-between">
                <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-xs font-medium text-muted">
                  {p.key}
                </span>
                <span
                  aria-hidden="true"
                  className="text-muted transition-transform duration-200 group-hover:translate-x-1 group-hover:text-accent"
                >
                  →
                </span>
              </span>
              <span className="text-base font-semibold [transform:translateZ(24px)]">{p.name}</span>
            </Link>
          </li>
        ))}
        {projects.data?.length === 0 && <li className="text-sm text-muted">Nenhum projeto ainda.</li>}
      </ul>
      <form
        className="grid animate-fade-up gap-3 rounded-2xl border border-border bg-surface/85 p-5 shadow-card backdrop-blur-xl sm:grid-cols-[9rem_1fr_auto] sm:items-end"
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
        <Field
          label="Chave"
          name="key"
          required
          placeholder="PLAT"
          maxLength={10}
          className="font-mono uppercase"
        />
        <Field label="Nome" name="name" required placeholder="Plataforma" />
        <Button type="submit" disabled={create.isPending}>
          Criar projeto
        </Button>
        <div className="sm:col-span-3 empty:hidden">
          <ErrorText error={create.error} />
        </div>
      </form>
    </main>
  )
}
