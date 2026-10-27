import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Navigate, Outlet, useNavigate } from "@tanstack/react-router"
import type { FormEvent } from "react"
import { ApiError, api, unwrap } from "./api.ts"
import { Button, ErrorText, Field } from "./ui.tsx"

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
    <main className="grid min-h-dvh place-items-center px-4">
      <form
        className="grid w-full max-w-sm gap-4 rounded-xl border border-border bg-surface p-6"
        onSubmit={(e) => {
          e.preventDefault()
          submit.mutate(fields(e))
        }}
      >
        <h1 className="text-lg font-semibold">
          {needed ? "Criar conta de administrador" : "Entrar no Makeit-Fast"}
        </h1>
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
        <Button type="submit" disabled={submit.isPending}>
          {needed ? "Criar e entrar" : "Entrar"}
        </Button>
      </form>
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
      <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-2">
        <Link to="/" className="font-semibold">
          Makeit-Fast
        </Link>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{me.data.name}</span>
          <button type="button" className="hover:text-text" onClick={() => logout.mutate()}>
            Sair
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
