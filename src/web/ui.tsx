import type { ComponentProps } from "react"

export const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted"

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      className={`rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60 ${className}`}
      {...props}
    />
  )
}

export function Field({ label, ...props }: { label: string } & ComponentProps<"input">) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input className={inputClass} {...props} />
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
