import { useQuery } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import { type FormEvent, lazy, type ReactNode, Suspense, useEffect, useRef, useState } from "react"
import { api, unwrap } from "./api.ts"
import { STATUS_LABEL, type Status, type useIssueMutations } from "./issues.ts"
import { ago, describeEvent, fullDate } from "./timeline.ts"
import { Button, ErrorText, inputClass, textareaClass } from "./ui.tsx"

const Markdown = lazy(() => import("./markdown.tsx"))

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function IssuePanel(props: {
  issueRef: string
  mutations: ReturnType<typeof useIssueMutations>
  onMove: (status: Status) => void
  onClose: () => void
}) {
  const { issueRef: ref, mutations, onClose } = props
  const issue = useQuery({
    queryKey: ["issue", ref],
    queryFn: () => unwrap(api.issues[":ref"].$get({ param: { ref } })),
  })
  const openedToEdit = useRouterState({ select: (s) => s.location.state.edit === true })
  const [editing, setEditing] = useState(openedToEdit)
  const heading = useRef<HTMLHeadingElement>(null)
  const loaded = Boolean(issue.data)

  useEffect(() => {
    if (loaded && !editing) heading.current?.focus()
  }, [loaded, editing])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return
      if (e.key === "Escape") onClose()
      else if (e.key === "e" && !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        setEditing(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const error = [
    mutations.addCriterion,
    mutations.setChecked,
    mutations.removeCriterion,
    mutations.update,
    mutations.comment,
  ].find((m) => m.error)?.error

  const data = issue.data
  const timeline = data
    ? [
        ...data.comments.map((c) => ({
          kind: "comment" as const,
          at: c.createdAt,
          id: `c${c.id}`,
          comment: c,
        })),
        ...data.events
          .filter((e) => e.kind !== "rejected") // the rejection note already shows up as a comment
          .map((e) => ({ kind: "event" as const, at: e.createdAt, id: `e${e.id}`, event: e })),
      ].sort((a, b) => a.at.localeCompare(b.at))
    : []

  return (
    <aside
      aria-label={`Issue ${ref}`}
      className="fixed inset-y-0 right-0 z-30 flex w-full animate-slide-in flex-col border-l border-border bg-surface/95 shadow-float backdrop-blur-xl sm:w-[34rem]"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-6">
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{ref}</span>
        <div className="flex items-center gap-1">
          {!editing && data && (
            <Button variant="ghost" className="h-8 px-2.5" onClick={() => setEditing(true)}>
              Editar <kbd>e</kbd>
            </Button>
          )}
          <Button variant="ghost" className="h-8 px-2.5" onClick={onClose}>
            Fechar <kbd>Esc</kbd>
          </Button>
        </div>
      </div>
      {!data ? (
        <div className="p-6">
          <ErrorText error={issue.error} />
        </div>
      ) : (
        <div className="grid flex-1 content-start gap-7 overflow-y-auto px-6 py-6">
          {editing ? (
            <EditForm
              issue={data}
              onCancel={() => setEditing(false)}
              onSave={(patch) => {
                mutations.update.mutate({ ref, ...patch })
                setEditing(false)
              }}
            />
          ) : (
            <>
              <h2
                ref={heading}
                tabIndex={-1}
                className="text-xl leading-snug font-semibold tracking-tight outline-none"
              >
                {data.title}
              </h2>
              <label className="grid gap-1.5 text-sm">
                <span className="text-xs font-medium text-muted">Status</span>
                <select
                  className={inputClass}
                  value={data.status}
                  onChange={(e) => props.onMove(e.target.value as Status)}
                >
                  {Object.entries(STATUS_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Section title="Problema">
                {data.description ? (
                  <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{data.description}</p>}>
                    <Markdown source={data.description} />
                  </Suspense>
                ) : (
                  <Empty onClick={() => setEditing(true)}>Descreva o problema e o motivo…</Empty>
                )}
              </Section>
              <Section title="Arquivos relevantes">
                {data.contextFiles.length ? (
                  <ul className="grid gap-1">
                    {data.contextFiles.map((file) => (
                      <li key={file} className="truncate font-mono text-xs text-muted">
                        {file}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty onClick={() => setEditing(true)}>Liste os arquivos que o agente deve olhar…</Empty>
                )}
              </Section>
            </>
          )}
          <Section
            title="Critérios de aceite"
            aside={`${data.criteria.filter((c) => c.checked).length}/${data.criteria.length}`}
          >
            <ul className="grid gap-1.5">
              {data.criteria.map((c) => (
                <li
                  key={c.id}
                  className="group flex animate-fade-up items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:border-accent/30"
                >
                  <input
                    type="checkbox"
                    id={`criterion-${c.id}`}
                    checked={c.checked}
                    className="mt-0.5 size-4 accent-[var(--accent)]"
                    onChange={(e) =>
                      mutations.setChecked.mutate({ ref, id: c.id, checked: e.target.checked })
                    }
                  />
                  <label
                    htmlFor={`criterion-${c.id}`}
                    className={`flex-1 transition-colors ${c.checked ? "text-muted line-through decoration-muted/50" : ""}`}
                  >
                    {c.text}
                    {c.testRef && (
                      <span className="block font-mono text-xs text-muted">teste: {c.testRef}</span>
                    )}
                  </label>
                  <button
                    type="button"
                    aria-label={`Remover critério: ${c.text}`}
                    className="grid size-5 place-items-center rounded text-muted opacity-0 transition group-hover:opacity-100 hover:bg-surface-2 hover:text-danger focus-visible:opacity-100"
                    onClick={() => mutations.removeCriterion.mutate({ ref, id: c.id })}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const input = e.currentTarget.elements.namedItem("text") as HTMLInputElement
                if (!input.value.trim()) return
                mutations.addCriterion.mutate({ ref, text: input.value })
                input.value = ""
              }}
            >
              <input
                name="text"
                aria-label="Novo critério de aceite"
                placeholder="Novo critério verificável… Enter adiciona"
                maxLength={500}
                className={inputClass}
              />
            </form>
          </Section>
          <ErrorText error={error ?? null} />
          <Section title="Atividade">
            <ol className="grid gap-3">
              {timeline.map((item) =>
                item.kind === "comment" ? (
                  <li
                    key={item.id}
                    className="grid animate-fade-up gap-1.5 rounded-xl border border-border bg-surface p-3"
                  >
                    <span className="flex items-baseline gap-2 text-xs text-muted">
                      <span className="font-medium text-text">{item.comment.author?.name ?? "Agente"}</span>
                      <time dateTime={item.at} title={fullDate(item.at)}>
                        {ago(item.at)}
                      </time>
                    </span>
                    <Suspense fallback={<p className="text-sm whitespace-pre-wrap">{item.comment.body}</p>}>
                      <Markdown source={item.comment.body} />
                    </Suspense>
                  </li>
                ) : (
                  <li key={item.id} className="flex items-baseline gap-2 px-1 text-xs text-muted">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-border"
                    />
                    <span>
                      <span className="font-medium text-text">{item.event.actor?.name ?? "Agente"}</span>{" "}
                      {describeEvent(item.event.kind, item.event.data)}
                    </span>
                    <time className="ml-auto shrink-0" dateTime={item.at} title={fullDate(item.at)}>
                      {ago(item.at)}
                    </time>
                  </li>
                ),
              )}
            </ol>
            <CommentForm onSubmit={(body) => mutations.comment.mutate({ ref, body })} />
          </Section>
        </div>
      )}
    </aside>
  )
}

function Section(props: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h3 className="flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
        {props.title}
        {props.aside && <span className="font-normal tabular-nums">{props.aside}</span>}
      </h3>
      {props.children}
    </section>
  )
}

function Empty(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-lg border border-dashed border-border px-3 py-2 text-left text-sm text-muted transition hover:border-accent/40 hover:text-text"
    >
      {props.children}
    </button>
  )
}

// Ctrl/Cmd+Enter submits a textarea's form, the usual convention for multi-line inputs.
const submitOnModEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    e.currentTarget.form?.requestSubmit()
  }
}

function EditForm(props: {
  issue: { title: string; description: string; contextFiles: string[] }
  onSave: (patch: { title: string; description: string; contextFiles: string[] }) => void
  onCancel: () => void
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const title = String(data.get("title")).trim()
    if (!title) return
    props.onSave({
      title,
      description: String(data.get("description")),
      contextFiles: String(data.get("contextFiles"))
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean),
    })
  }
  return (
    <form
      className="grid animate-fade-up gap-4"
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          props.onCancel()
        }
      }}
    >
      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted">Título</span>
        <input
          name="title"
          required
          maxLength={240}
          defaultValue={props.issue.title}
          autoFocus
          className={`${inputClass} text-base font-semibold`}
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted">Problema (Markdown)</span>
        <textarea
          name="description"
          rows={8}
          defaultValue={props.issue.description}
          onKeyDown={submitOnModEnter}
          className={`${textareaClass} font-mono text-xs leading-relaxed`}
        />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted">Arquivos relevantes (um por linha)</span>
        <textarea
          name="contextFiles"
          rows={3}
          defaultValue={props.issue.contextFiles.join("\n")}
          onKeyDown={submitOnModEnter}
          placeholder="src/server/issues.ts"
          className={`${textareaClass} font-mono text-xs`}
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted">
          <kbd>Ctrl</kbd>+<kbd>Enter</kbd> salva · <kbd>Esc</kbd> cancela
        </span>
        <Button type="button" variant="ghost" onClick={props.onCancel}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </div>
    </form>
  )
}

function CommentForm({ onSubmit }: { onSubmit: (body: string) => void }) {
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const field = e.currentTarget.elements.namedItem("body") as HTMLTextAreaElement
        if (!field.value.trim()) return
        onSubmit(field.value)
        field.value = ""
      }}
    >
      <textarea
        name="body"
        rows={3}
        aria-label="Novo comentário"
        placeholder="Comentar em Markdown… Ctrl+Enter envia"
        onKeyDown={submitOnModEnter}
        className={textareaClass}
      />
      <div className="flex justify-end">
        <Button type="submit" className="h-8">
          Comentar
        </Button>
      </div>
    </form>
  )
}
