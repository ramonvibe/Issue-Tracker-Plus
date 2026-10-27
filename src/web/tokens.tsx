import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api, unwrap } from "./api.ts"
import { fullDate } from "./timeline.ts"
import { Button, ErrorText, Field } from "./ui.tsx"

export function TokensPage() {
  const queryClient = useQueryClient()
  const tokens = useQuery({ queryKey: ["tokens"], queryFn: () => unwrap(api.tokens.$get()) })
  const [secret, setSecret] = useState<{ name: string; token: string } | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tokens"] })
  const create = useMutation({
    mutationFn: (name: string) => unwrap(api.tokens.$post({ json: { name } })),
    onSuccess: (t) => setSecret({ name: t.name, token: t.token }),
    onSettled: refresh,
  })
  const revoke = useMutation({
    mutationFn: (id: number) => unwrap(api.tokens[":id"].$delete({ param: { id: String(id) } })),
    onSettled: refresh,
  })

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
      <div className="grid animate-fade-up gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tokens de API</h1>
        <p className="text-sm text-muted">
          Agentes usam{" "}
          <code className="rounded bg-surface-2 px-1 font-mono text-xs">
            Authorization: Bearer &lt;token&gt;
          </code>{" "}
          para buscar contexto, mover issues e vincular PRs. Cada token age em seu nome.
        </p>
      </div>
      <form
        className="grid animate-fade-up gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const form = e.currentTarget
          create.mutate(String(new FormData(form).get("name")), { onSuccess: () => form.reset() })
        }}
      >
        <Field label="Nome do token" name="name" required maxLength={80} placeholder="claude-notebook" />
        <Button type="submit" disabled={create.isPending}>
          Criar token
        </Button>
        <div className="empty:hidden sm:col-span-2">
          <ErrorText error={create.error ?? revoke.error} />
        </div>
      </form>
      {secret && (
        <div
          role="status"
          className="grid animate-pop gap-2 rounded-2xl border border-accent/40 bg-accent/5 p-5"
        >
          <p className="text-sm font-medium">
            Token “{secret.name}” criado. Copie agora: ele não será mostrado de novo.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              aria-label="Token criado"
              value={secret.token}
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 font-mono text-xs"
            />
            <Button type="button" onClick={() => navigator.clipboard.writeText(secret.token)}>
              Copiar
            </Button>
          </div>
        </div>
      )}
      <ul className="grid gap-2">
        {tokens.data?.map((t) => (
          <li
            key={t.id}
            className={`flex animate-fade-up flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-surface px-4 py-3 text-sm ${t.revokedAt ? "opacity-60" : ""}`}
          >
            <span className="font-medium">{t.name}</span>
            <span className="text-xs text-muted">criado em {fullDate(t.createdAt)}</span>
            <span className="text-xs text-muted">
              {t.lastUsedAt ? `último uso ${fullDate(t.lastUsedAt)}` : "nunca usado"}
            </span>
            {t.revokedAt ? (
              <span className="ml-auto text-xs text-muted">revogado</span>
            ) : (
              <Button
                variant="ghost"
                className="ml-auto h-8 hover:text-danger"
                onClick={() => revoke.mutate(t.id)}
                aria-label={`Revogar token ${t.name}`}
              >
                Revogar
              </Button>
            )}
          </li>
        ))}
        {tokens.data?.length === 0 && <li className="text-sm text-muted">Nenhum token ainda.</li>}
      </ul>
    </main>
  )
}
