export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429

// Thrown by domain code; the HTTP layer renders it as {"error":{"code","message"}}.
export class AppError extends Error {
  readonly status: ErrorStatus
  readonly code: string

  constructor(status: ErrorStatus, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// postgres.js errors may arrive wrapped by Drizzle, with the original in `cause`.
export function isUniqueViolation(error: unknown): boolean {
  for (let e = error as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return true
  }
  return false
}
