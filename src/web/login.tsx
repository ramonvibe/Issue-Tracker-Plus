import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { ApiError, api, unwrap } from "./api.ts"
import { FlowBackground } from "./flow-background.tsx"
import { Button, ErrorText, Field, Logo } from "./ui.tsx"

const fields = (e: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>

export function LoginPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => unwrap(api.setup.$get()) })
  const submit = useMutation({
    mutationFn: (form: Record<string, string>) =>
      setup.data?.needed
        ? unwrap(
            api.setup.$post({
              json: { name: form.name ?? "", email: form.email ?? "", password: form.password ?? "" },
            }),
          )
        : unwrap(api.session.$post({ json: { email: form.email ?? "", password: form.password ?? "" } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      navigate({ to: "/" })
    },
  })
  if (!setup.data) return null
  const needed = setup.data.needed

  return (
    <main className="relative isolate grid min-h-dvh place-items-center px-4 py-10">
      <FlowBackground />
      <div className="grid w-full max-w-sm animate-fade-up gap-6">
        <div className="grid justify-items-center gap-2 text-center">
          <Logo />
          <p className="text-sm text-muted">Você decide e revisa. Os agentes implementam.</p>
        </div>
        <form
          className="grid gap-4 rounded-2xl border border-border bg-surface/85 p-6 shadow-float backdrop-blur-xl"
          onSubmit={(e) => {
            e.preventDefault()
            submit.mutate(fields(e))
          }}
        >
          <h1 className="text-base font-semibold">{needed ? "Criar conta de administrador" : "Entrar"}</h1>
          {needed && <Field label="Nome" name="name" required autoComplete="name" />}
          <Field label="Email" name="email" type="email" required autoComplete="email" />
          <Field
            label="Senha"
            name="password"
            type="password"
            required
            minLength={needed ? 12 : undefined}
            autoComplete={needed ? "new-password" : "current-password"}
          />
          <ErrorText error={submit.error} />
          <Button type="submit" disabled={submit.isPending} className="mt-1 w-full">
            {needed ? "Criar e entrar" : "Entrar"}
          </Button>
        </form>
      </div>
    </main>
  )
}

export function AuthedLayout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery({ queryKey: ["me"], queryFn: () => unwrap(api.me.$get()) })
  const logout = useMutation({
    mutationFn: () => unwrap(api.session.$delete()),
    onSuccess: () => {
      queryClient.clear()
      navigate({ to: "/login" })
    },
  })
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to="/login" />
  if (!me.data) return <ErrorText error={me.error} />

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-4 border-b border-border bg-surface/80 px-4 backdrop-blur-xl">
        <Link to="/" className="rounded-md">
          <Logo />
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className="grid size-7 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted"
          >
            {me.data.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden text-muted sm:inline">{me.data.name}</span>
          <Button variant="ghost" className="h-8 px-2.5" onClick={() => logout.mutate()}>
            Sair
          </Button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
