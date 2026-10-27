import { type ComponentProps, useEffect, useState } from "react"

const control =
  "w-full rounded-lg border border-border bg-surface text-sm text-text outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-3 focus:ring-accent/20"
export const inputClass = `h-9 px-3 ${control}`
export const textareaClass = `px-3 py-2 ${control}`

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "ghost" }) {
  const look =
    variant === "primary"
      ? "bg-accent text-accent-fg shadow-card hover:brightness-110 active:brightness-95"
      : "text-muted hover:bg-surface-2 hover:text-text"
  return (
    <button
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition disabled:opacity-60 ${look} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, className = "", ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input className={`${inputClass} ${className}`} {...props} />
    </label>
  )
}

export function ErrorText({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error.message}
    </p>
  ) : null
}

export type ToastMessage = { text: string; tone: "error" | "ok" }

// Floating message; errors are alerts, confirmations are polite status updates.
export function Toast({ message, onDismiss }: { message: ToastMessage | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, message.tone === "error" ? 6000 : 2500)
    return () => clearTimeout(timer)
  }, [message, onDismiss])
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        role={message.tone === "error" ? "alert" : "status"}
        className="pointer-events-auto flex max-w-lg animate-pop items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-float"
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${message.tone === "error" ? "bg-danger" : "bg-[var(--st-done)]"}`}
        />
        <span>{message.text}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-muted hover:text-text"
          aria-label="Fechar aviso"
        >
          ×
        </button>
      </div>
    </div>
  )
}

export function Logo() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden="true"
        className="grid size-6 place-items-center rounded-md bg-accent text-[0.7rem] font-bold text-accent-fg shadow-card"
      >
        M
      </span>
      Makeit-Fast
    </span>
  )
}

export function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)"
  const [reduced, setReduced] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const media = matchMedia(query)
    const update = () => setReduced(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return reduced
}
