import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { api, unwrap } from "./api.ts"
import { STATUS_LABEL, type Status, type useIssueMutations } from "./issues.ts"
import { Button, ErrorText, inputClass } from "./ui.tsx"

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
  const heading = useRef<HTMLHeadingElement>(null)
  const loaded = Boolean(issue.data)

  useEffect(() => {
    if (loaded) heading.current?.focus()
  }, [loaded])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const error = [
    mutations.addCriterion,
    mutations.setChecked,
    mutations.removeCriterion,
    mutations.move,
  ].find((m) => m.error)?.error

  return (
    <aside
      aria-label={`Issue ${ref}`}
      className="fixed inset-y-0 right-0 z-30 grid w-full animate-slide-in content-start gap-6 overflow-y-auto border-l border-border bg-surface/95 p-6 shadow-float backdrop-blur-xl sm:w-[32rem]"
    >
      <div className="flex items-center justify-between">
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">{ref}</span>
        <Button variant="ghost" className="h-8 px-2.5" onClick={onClose}>
          Fechar <kbd>Esc</kbd>
        </Button>
      </div>
      {!issue.data ? (
        <ErrorText error={issue.error} />
      ) : (
        <>
          <h2
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold leading-snug tracking-tight outline-none"
          >
            {issue.data.title}
          </h2>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted">Status</span>
            <select
              className={inputClass}
              value={issue.data.status}
              onChange={(e) => props.onMove(e.target.value as Status)}
            >
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {issue.data.description && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{issue.data.description}</p>
          )}
          <section aria-labelledby="criteria-title" className="grid gap-3">
            <h3 id="criteria-title" className="flex items-center justify-between text-sm font-medium">
              Critérios de aceite
              <span className="text-xs font-normal text-muted tabular-nums">
                {issue.data.criteria.filter((c) => c.checked).length}/{issue.data.criteria.length}
              </span>
            </h3>
            <ul className="grid gap-1.5">
              {issue.data.criteria.map((c) => (
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
                    className="grid size-5 place-items-center rounded text-muted opacity-0 transition hover:bg-surface-2 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
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
                mutations.addCriterion.mutate(
                  { ref, text: input.value },
                  { onSuccess: () => (input.value = "") },
                )
              }}
            >
              <input
                name="text"
                aria-label="Novo critério de aceite"
                placeholder="Novo critério verificável… (Enter adiciona)"
                maxLength={500}
                className={inputClass}
              />
            </form>
          </section>
          <ErrorText error={error ?? null} />
        </>
      )}
    </aside>
  )
}
