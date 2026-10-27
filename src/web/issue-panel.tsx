import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { api, unwrap } from "./api.ts"
import { STATUS_LABEL, type Status, type useIssueMutations } from "./issues.ts"
import { ErrorText, inputClass } from "./ui.tsx"

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
      className="fixed inset-y-0 right-0 z-10 grid w-full content-start gap-5 overflow-y-auto border-l border-border bg-surface p-5 shadow-xl sm:w-[30rem]"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-muted">{ref}</span>
        <button type="button" onClick={onClose} className="text-sm text-muted hover:text-text">
          Fechar <kbd>Esc</kbd>
        </button>
      </div>
      {!issue.data ? (
        <ErrorText error={issue.error} />
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold">
            {issue.data.title}
          </h2>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Status</span>
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
          {issue.data.description && <p className="whitespace-pre-wrap text-sm">{issue.data.description}</p>}
          <section aria-labelledby="criteria-title" className="grid gap-2">
            <h3 id="criteria-title" className="text-sm font-medium">
              Critérios de aceite
            </h3>
            <ul className="grid gap-1">
              {issue.data.criteria.map((c) => (
                <li key={c.id} className="group flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    id={`criterion-${c.id}`}
                    checked={c.checked}
                    className="mt-1"
                    onChange={(e) =>
                      mutations.setChecked.mutate({ ref, id: c.id, checked: e.target.checked })
                    }
                  />
                  <label htmlFor={`criterion-${c.id}`} className="flex-1">
                    {c.text}
                    {c.testRef && (
                      <span className="block font-mono text-xs text-muted">teste: {c.testRef}</span>
                    )}
                  </label>
                  <button
                    type="button"
                    aria-label={`Remover critério: ${c.text}`}
                    className="text-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
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
