import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { api, unwrap } from "./api.ts"
import { IssuePanel } from "./issue-panel.tsx"
import {
  type BoardStatus,
  COLUMNS,
  parseRef,
  STATUS_LABEL,
  type Status,
  useIssueMutations,
} from "./issues.ts"
import { Button, ErrorText, inputClass } from "./ui.tsx"

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

export function BoardPage() {
  const { ref: segment } = useParams({ from: "/authed/$ref" })
  const { key, issueRef } = parseRef(segment)
  const navigate = useNavigate()
  const board = useQuery({
    queryKey: ["board", key],
    queryFn: () => unwrap(api.projects[":key"].board.$get({ param: { key } })),
  })
  const mutations = useIssueMutations(key)
  const [capturing, setCapturing] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState<Error | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const focusAfterRender = useRef<string | null>(null)

  const columns = board.data?.columns
  const statusOf = (ref: string) =>
    COLUMNS.find((c) => columns?.[c.status].some((i) => i.ref === ref))?.status

  const requestMove = (ref: string, status: Status, note?: string) => {
    if (statusOf(ref) === "review" && status === "in_progress" && note === undefined) return setRejecting(ref)
    setError(null)
    mutations.move.mutate(
      { ref, status, note },
      {
        // Runs after the board refetch, so the card is already in its new column and can take focus.
        onSuccess: () => {
          focusAfterRender.current = ref
          setMessage(`${ref} movida para ${STATUS_LABEL[status]}`)
        },
        onError: setError,
      },
    )
  }

  useEffect(() => {
    if (!focusAfterRender.current || issueRef) return
    document.querySelector<HTMLElement>(`[data-ref="${focusAfterRender.current}"]`)?.focus()
    focusAfterRender.current = null
  })

  useEffect(() => {
    if (!columns) return
    const grid = COLUMNS.map((c) => columns[c.status].map((i) => i.ref))
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("dialog[open]"))
        return
      if (issueRef) return // the open panel owns the keyboard
      const current = (document.activeElement as HTMLElement | null)?.dataset.ref
      const col = current ? grid.findIndex((refs) => refs.includes(current)) : -1
      const row = col >= 0 ? (grid[col] as string[]).indexOf(current as string) : -1
      const focus = (ref: string | undefined) => {
        if (!ref) return
        e.preventDefault()
        document.querySelector<HTMLElement>(`[data-ref="${ref}"]`)?.focus()
      }
      const columnKey =
        { h: col - 1, l: col + 1 }[e.key] ?? (/^[1-5]$/.test(e.key) ? Number(e.key) - 1 : null)

      if (e.key === "c") {
        e.preventDefault()
        // Render and focus the input before the next keystroke arrives, or fast typists lose letters.
        flushSync(() => setCapturing(true))
      } else if (col < 0 && ["j", "k", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        focus(grid.flat()[0])
      } else if (e.key === "j" || e.key === "ArrowDown") {
        focus(grid[col]?.[row + 1])
      } else if (e.key === "k" || e.key === "ArrowUp") {
        focus(grid[col]?.[row - 1])
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const step = e.key === "ArrowLeft" ? -1 : 1
        for (let c = col + step; c >= 0 && c < grid.length; c += step) {
          const refs = grid[c] as string[]
          if (refs.length) return focus(refs[Math.min(row, refs.length - 1)])
        }
      } else if (current && columnKey !== null && COLUMNS[columnKey] && columnKey !== col) {
        e.preventDefault()
        requestMove(current, COLUMNS[columnKey].status)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  if (!board.data || !columns) return <ErrorText error={board.error} />
  const { project } = board.data

  return (
    <main className="grid gap-4 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold">
          <span className="font-mono text-muted">{project.key}</span> {project.name}
        </h1>
        <p className="text-xs text-muted">
          <kbd>c</kbd> nova ideia · <kbd>j</kbd>/<kbd>k</kbd> navegar · <kbd>h</kbd>/<kbd>l</kbd> ou{" "}
          <kbd>1</kbd>–<kbd>5</kbd> mover · <kbd>Enter</kbd> abrir
        </p>
      </div>
      <p aria-live="polite" className="sr-only">
        {message}
      </p>
      <ErrorText error={error} />
      <div className="grid gap-3 md:grid-cols-5">
        {COLUMNS.map(({ status, title }) => (
          <Column
            key={status}
            status={status}
            title={title}
            count={columns[status].length}
            limit={project.wipLimits[status as "in_progress" | "review"]}
          >
            {status === "idea" && capturing && (
              <CaptureInput
                pending={mutations.create.isPending}
                error={mutations.create.error}
                onSubmit={(title) =>
                  mutations.create.mutate(title, { onSuccess: (i) => setMessage(`${i.ref} criada`) })
                }
                onClose={() => setCapturing(false)}
              />
            )}
            {columns[status].map((issue) => (
              <li key={issue.ref}>
                <Link
                  to="/$ref"
                  params={{ ref: issue.ref }}
                  data-ref={issue.ref}
                  className="grid gap-1 rounded-md border border-border bg-bg px-3 py-2 text-sm hover:border-accent focus-visible:border-accent"
                >
                  <span className="flex justify-between gap-2 font-mono text-xs text-muted">
                    {issue.ref}
                    {issue.criteriaTotal > 0 && (
                      <span>
                        {issue.criteriaChecked}/{issue.criteriaTotal}
                        <span className="sr-only"> critérios marcados</span>
                      </span>
                    )}
                  </span>
                  <span>{issue.title}</span>
                </Link>
              </li>
            ))}
            {columns[status].length === 0 && !(status === "idea" && capturing) && (
              <li className="px-1 text-xs text-muted">Vazia</li>
            )}
          </Column>
        ))}
      </div>
      {issueRef && (
        <IssuePanel
          issueRef={issueRef}
          mutations={mutations}
          onMove={(status) => requestMove(issueRef, status)}
          onClose={() => {
            focusAfterRender.current = issueRef
            navigate({ to: "/$ref", params: { ref: key } })
          }}
        />
      )}
      {rejecting && (
        <NoteDialog
          issueRef={rejecting}
          onCancel={() => setRejecting(null)}
          onSubmit={(note) => {
            setRejecting(null)
            requestMove(rejecting, "in_progress", note)
          }}
        />
      )}
    </main>
  )
}

function Column(props: {
  status: BoardStatus
  title: string
  count: number
  limit?: number
  children: ReactNode
}) {
  const { count } = props
  return (
    <section
      aria-labelledby={`col-${props.status}`}
      className="grid content-start gap-2 rounded-lg border border-border bg-surface p-2"
    >
      <h2 id={`col-${props.status}`} className="flex items-center justify-between px-1 text-sm font-medium">
        {props.title}
        <span className="text-xs text-muted">
          <span aria-hidden="true">{props.limit ? `${count}/${props.limit}` : count}</span>
          <span className="sr-only">{props.limit ? `${count} de ${props.limit}` : `${count} issues`}</span>
        </span>
      </h2>
      <ul className="grid min-h-16 content-start gap-2">{props.children}</ul>
    </section>
  )
}

function CaptureInput(props: {
  pending: boolean
  error: Error | null
  onSubmit: (title: string) => void
  onClose: () => void
}) {
  return (
    <li className="grid gap-1">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const input = e.currentTarget.elements.namedItem("title") as HTMLInputElement
          if (!input.value.trim()) return
          props.onSubmit(input.value)
          input.value = ""
        }}
      >
        <input
          name="title"
          aria-label="Título da nova ideia"
          placeholder="Nova ideia… (Enter cria, Esc fecha)"
          maxLength={240}
          autoFocus
          className={inputClass}
          onKeyDown={(e) => e.key === "Escape" && props.onClose()}
          onBlur={(e) => !e.currentTarget.value && props.onClose()}
        />
      </form>
      <ErrorText error={props.error} />
    </li>
  )
}

function NoteDialog(props: { issueRef: string; onSubmit: (note: string) => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => dialog.current?.showModal(), [])
  return (
    <dialog
      ref={dialog}
      onClose={props.onCancel}
      aria-labelledby="note-title"
      className="m-auto w-full max-w-md rounded-xl border border-border bg-surface p-5 text-text backdrop:bg-black/40"
    >
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          const note = String(new FormData(e.currentTarget).get("note") ?? "").trim()
          if (note) props.onSubmit(note)
        }}
      >
        <h2 id="note-title" className="font-semibold">
          Devolver {props.issueRef} para Em execução
        </h2>
        <p className="text-sm text-muted">O que faltou? A nota vira comentário e conta como retrabalho.</p>
        <textarea name="note" required rows={4} aria-label="Nota de rejeição" className={inputClass} />
        <div className="flex justify-end gap-2">
          <button type="button" className="px-3 py-2 text-sm text-muted" onClick={props.onCancel}>
            Cancelar
          </button>
          <Button type="submit">Devolver</Button>
        </div>
      </form>
    </dialog>
  )
}
