import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { api, unwrap } from "./api.ts"
import { type Board, type Card, moveCard } from "./board-cache.ts"
import { IssuePanel } from "./issue-panel.tsx"
import {
  type BoardStatus,
  COLUMNS,
  parseRef,
  STATUS_LABEL,
  type Status,
  useIssueMutations,
} from "./issues.ts"
import { Button, ErrorText, inputClass, Toast, textareaClass } from "./ui.tsx"

type Columns = Board["columns"]
type Placement = { after?: string; before?: string }

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
const statusIn = (columns: Columns, ref: string) =>
  COLUMNS.find((c) => columns[c.status].some((i) => i.ref === ref))?.status
const neighbours = (cards: Card[], ref: string): Placement => {
  const i = cards.findIndex((c) => c.ref === ref)
  return { after: cards[i - 1]?.ref, before: cards[i + 1]?.ref }
}

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
  const [rejecting, setRejecting] = useState<({ ref: string } & Placement) | null>(null)
  const [drag, setDrag] = useState<{ ref: string; columns: Columns } | null>(null)
  // Card to focus once it shows up in the given column (moves re-mount cards in their new column).
  const focusAfterRender = useRef<{ ref: string; status?: Status } | null>(null)
  const justDragged = useRef(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const dismissError = useCallback(() => setError(null), [])

  const columns = board.data?.columns

  const requestMove = (ref: string, status: Status, placement: Placement & { note?: string } = {}) => {
    if (!columns) return
    if (statusIn(columns, ref) === "review" && status === "in_progress" && placement.note === undefined) {
      return setRejecting({ ref, ...placement })
    }
    setError(null)
    const origin = statusIn(columns, ref)
    focusAfterRender.current = { ref, status }
    mutations.move.mutate(
      { ref, status, ...placement },
      {
        onSuccess: () => setMessage(`${ref} movida para ${STATUS_LABEL[status]}`),
        onError: (e) => {
          // The rollback re-mounts the card in its old column; give it focus back.
          focusAfterRender.current = { ref, status: origin }
          setError(e)
        },
      },
    )
  }

  useEffect(() => {
    const target = focusAfterRender.current
    if (!target || issueRef || drag) return
    const column = target.status ? `#col-${target.status} + ul ` : ""
    const el = document.querySelector<HTMLElement>(`${column}[data-ref="${target.ref}"]`)
    if (!el) return
    if (el !== document.activeElement) el.focus()
    focusAfterRender.current = null
  })

  useEffect(() => {
    if (!columns) return
    const grid = COLUMNS.map((c) => (columns[c.status] as Card[]).filter((i) => !i.pending).map((i) => i.ref))
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
  const view = drag?.columns ?? columns
  const limits = project.wipLimits as Partial<Record<BoardStatus, number>>
  const reviewLimit = limits.review
  const flowBlocked = reviewLimit !== undefined && columns.review.length >= reviewLimit

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !drag) return
    const ref = String(active.id)
    const overId = String(over.id)
    const from = statusIn(drag.columns, ref)
    const to = overId.startsWith("col:") ? (overId.slice(4) as BoardStatus) : statusIn(drag.columns, overId)
    if (!from || !to || from === to) return
    const placement = overId.startsWith("col:") ? {} : { before: overId }
    setDrag({ ref, columns: moveCard({ ...board.data, columns: drag.columns }, ref, to, placement).columns })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = drag
    setDrag(null)
    justDragged.current = true
    setTimeout(() => {
      justDragged.current = false
    })
    if (!current || !over) return
    const ref = String(active.id)
    const status = statusIn(current.columns, ref)
    if (!status) return
    let cards = current.columns[status]
    const overIndex = cards.findIndex((c) => c.ref === String(over.id))
    if (overIndex >= 0) {
      cards = arrayMove(
        cards,
        cards.findIndex((c) => c.ref === ref),
        overIndex,
      )
    }
    const placement = neighbours(cards, ref)
    const original = statusIn(columns, ref)
    const unchanged = neighbours(columns[original ?? status], ref)
    if (status === original && placement.after === unchanged.after && placement.before === unchanged.before)
      return
    requestMove(ref, status, placement)
  }

  const dragged =
    drag &&
    Object.values(drag.columns)
      .flat()
      .find((c) => c.ref === drag.ref)

  return (
    <main
      className="flex flex-col gap-3 p-4 md:h-[calc(100dvh-3rem)]"
      onClickCapture={(e) => {
        if (justDragged.current) e.preventDefault()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <Link to="/" className="text-sm text-muted hover:text-text">
            Projetos
          </Link>
          <span aria-hidden="true" className="text-muted/50">
            /
          </span>
          <h1 className="flex items-center gap-2 text-base font-semibold">
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
              {project.key}
            </span>
            {project.name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="hidden items-center gap-1.5 text-xs text-muted lg:flex">
            <kbd>c</kbd> nova ideia <span aria-hidden="true">·</span> <kbd>j</kbd>
            <kbd>k</kbd> navegar <span aria-hidden="true">·</span> <kbd>h</kbd>
            <kbd>l</kbd> ou <kbd>1</kbd>–<kbd>5</kbd> mover <span aria-hidden="true">·</span> <kbd>Enter</kbd>{" "}
            abrir
          </p>
          <WipSettings limits={limits} onSave={(l) => mutations.setWipLimits.mutate(l)} />
        </div>
      </div>
      {flowBlocked && (
        <div
          role="status"
          className="flex animate-fade-up items-center gap-2 rounded-xl border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning"
        >
          <span aria-hidden="true" className="size-2 animate-wip-pulse rounded-full bg-warning" />
          Revisão cheia ({columns.review.length}/{reviewLimit}): revise antes de puxar mais trabalho para Em
          execução.
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {message}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={({ active }) => setDrag({ ref: String(active.id), columns })}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-5">
          {COLUMNS.map(({ status, title }) => (
            <Column
              key={status}
              status={status}
              title={title}
              count={view[status].length}
              limit={limits[status]}
              blocked={status === "in_progress" && flowBlocked}
            >
              {status === "idea" && capturing && (
                <CaptureInput
                  error={mutations.create.error}
                  onSubmit={(title) =>
                    mutations.create.mutate(title, { onSuccess: (i) => setMessage(`${i.ref} criada`) })
                  }
                  onClose={() => setCapturing(false)}
                />
              )}
              <SortableContext items={view[status].map((c) => c.ref)} strategy={verticalListSortingStrategy}>
                {view[status].map((card) => (
                  <SortableCard key={card.ref} card={card} />
                ))}
              </SortableContext>
              {view[status].length === 0 && !(status === "idea" && capturing) && (
                <li className="grid h-16 place-items-center rounded-xl border border-dashed border-border text-xs text-muted">
                  {status === "idea" ? (
                    <span>
                      <kbd>c</kbd> para capturar
                    </span>
                  ) : (
                    "Vazia"
                  )}
                </li>
              )}
            </Column>
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }}>
          {dragged && <CardView card={dragged} className="rotate-2 scale-[1.03] shadow-float" />}
        </DragOverlay>
      </DndContext>
      {issueRef && (
        <IssuePanel
          issueRef={issueRef}
          mutations={mutations}
          onMove={(status) => requestMove(issueRef, status)}
          onClose={() => {
            focusAfterRender.current = { ref: issueRef }
            navigate({ to: "/$ref", params: { ref: key } })
          }}
        />
      )}
      {rejecting && (
        <NoteDialog
          issueRef={rejecting.ref}
          onCancel={() => setRejecting(null)}
          onSubmit={(note) => {
            const { ref, ...placement } = rejecting
            setRejecting(null)
            requestMove(ref, "in_progress", { ...placement, note })
          }}
        />
      )}
      <Toast error={error} onDismiss={dismissError} />
    </main>
  )
}

function Column(props: {
  status: BoardStatus
  title: string
  count: number
  limit?: number
  blocked: boolean
  children: ReactNode
}) {
  const { count, limit } = props
  const { setNodeRef, isOver } = useDroppable({ id: `col:${props.status}` })
  const full = limit !== undefined && count >= limit
  const pill = !full
    ? "bg-surface text-muted"
    : count > limit
      ? "bg-danger/15 text-danger ring-1 ring-danger/40"
      : "animate-wip-pulse bg-warning-bg text-warning ring-1 ring-warning/40"
  return (
    <section
      aria-labelledby={`col-${props.status}`}
      className={`flex min-h-0 flex-col rounded-2xl border bg-surface-2/60 transition-colors ${isOver ? "border-accent/50 bg-accent/5" : "border-border"}`}
    >
      <h2
        id={`col-${props.status}`}
        className="flex h-11 shrink-0 items-center gap-2 px-3 text-sm font-medium"
      >
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ background: `var(--st-${props.status})` }}
        />
        {props.title}
        {props.blocked && (
          <span className="rounded-full bg-warning-bg px-1.5 py-px text-[0.65rem] font-medium text-warning">
            bloqueada
          </span>
        )}
        <span
          className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-medium tabular-nums ${pill}`}
        >
          <span aria-hidden="true">{limit !== undefined ? `${count}/${limit}` : count}</span>
          <span className="sr-only">{limit !== undefined ? `${count} de ${limit}` : `${count} issues`}</span>
        </span>
      </h2>
      <ul ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {props.children}
      </ul>
    </section>
  )
}

function SortableCard({ card }: { card: Card }) {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: card.ref,
    disabled: card.pending,
  })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
    >
      {/* Pointer-only drag; the keyboard alternative is h/l and 1–5 on the focused card. */}
      <CardView card={card} {...listeners} />
    </li>
  )
}

function CardView({
  card,
  className = "",
  ...rest
}: { card: Card; className?: string } & Record<string, unknown>) {
  const look = `block animate-fade-up rounded-xl border border-border bg-surface p-3 shadow-card transition-[transform,box-shadow,border-color] duration-150 ${className}`
  const body = (
    <>
      <span className="flex items-center justify-between font-mono text-[0.7rem] text-muted">
        {card.pending ? "criando…" : card.ref}
        {card.criteriaTotal > 0 && (
          <span className={card.criteriaChecked === card.criteriaTotal ? "text-[var(--st-done)]" : ""}>
            {card.criteriaChecked}/{card.criteriaTotal}
            <span className="sr-only"> critérios marcados</span>
          </span>
        )}
      </span>
      <span className="mt-1.5 block text-sm leading-snug">{card.title}</span>
      {card.criteriaTotal > 0 && (
        <span aria-hidden="true" className="mt-2.5 block h-1 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full bg-[var(--st-done)] transition-[width] duration-300"
            style={{ width: `${(card.criteriaChecked / card.criteriaTotal) * 100}%` }}
          />
        </span>
      )}
    </>
  )
  if (card.pending) return <div className={`${look} opacity-60`}>{body}</div>
  return (
    <Link
      to="/$ref"
      params={{ ref: card.ref }}
      data-ref={card.ref}
      className={`${look} hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-float focus-visible:border-accent`}
      {...rest}
    >
      {body}
    </Link>
  )
}

function CaptureInput(props: {
  error: Error | null
  onSubmit: (title: string) => void
  onClose: () => void
}) {
  return (
    <li className="grid animate-fade-up gap-1">
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
          placeholder="Nova ideia… Enter cria, Esc fecha"
          maxLength={240}
          autoFocus
          className={`${inputClass} shadow-card`}
          onKeyDown={(e) => e.key === "Escape" && props.onClose()}
          onBlur={(e) => !e.currentTarget.value && props.onClose()}
        />
      </form>
      <ErrorText error={props.error} />
    </li>
  )
}

function WipSettings(props: {
  limits: Partial<Record<BoardStatus, number>>
  onSave: (limits: { in_progress: number | null; review: number | null }) => void
}) {
  const parse = (value: FormDataEntryValue | null) => (value ? Number(value) : null)
  return (
    <details className="relative">
      <summary className="flex h-8 cursor-pointer list-none items-center rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-muted transition hover:text-text">
        Limites de WIP
      </summary>
      <form
        className="absolute right-0 z-30 mt-2 grid w-64 animate-pop gap-3 rounded-xl border border-border bg-surface p-4 shadow-float"
        onSubmit={(e) => {
          e.preventDefault()
          const data = new FormData(e.currentTarget)
          props.onSave({ in_progress: parse(data.get("in_progress")), review: parse(data.get("review")) })
          e.currentTarget.closest("details")?.removeAttribute("open")
        }}
      >
        {(["in_progress", "review"] as const).map((status) => (
          <label key={status} className="flex items-center justify-between gap-3 text-sm">
            {STATUS_LABEL[status]}
            <input
              name={status}
              type="number"
              min={1}
              max={99}
              placeholder="∞"
              defaultValue={props.limits[status]}
              className={`${inputClass} w-20 text-right tabular-nums`}
            />
          </label>
        ))}
        <p className="text-xs text-muted">
          Vazio = sem limite. Revisão cheia bloqueia novas entradas em Em execução.
        </p>
        <Button type="submit" className="h-8">
          Salvar
        </Button>
      </form>
    </details>
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
      className="m-auto w-full max-w-md animate-pop rounded-2xl border border-border bg-surface p-5 text-text shadow-float backdrop:bg-black/40 backdrop:backdrop-blur-sm"
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
        <textarea name="note" required rows={4} aria-label="Nota de rejeição" className={textareaClass} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={props.onCancel}>
            Cancelar
          </Button>
          <Button type="submit">Devolver</Button>
        </div>
      </form>
    </dialog>
  )
}
