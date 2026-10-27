import { hc } from "hono/client"
import type { AppType } from "../server/app.ts"

export const api = hc<AppType>("/").api

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Turns a non-2xx response into an ApiError carrying the server's {"error":{code,message}}.
export async function unwrap<T>(request: Promise<{ ok: boolean; status: number; json(): Promise<T> }>) {
  const res = await request
  if (res.ok) return res.status === 204 ? (undefined as T) : res.json()
  const body = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string } }
  throw new ApiError(res.status, body.error?.code ?? "unknown", body.error?.message ?? "Erro inesperado")
}
