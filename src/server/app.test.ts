import { describe, expect, test } from "vitest"
import { createApp } from "./app.ts"
import { db } from "./test/db.ts"

const admin = { name: "Ana", email: "ana@example.com", password: "senha-segura-123" }

function client(secureCookies = false) {
  const app = createApp({ db, secureCookies })
  let cookie = ""
  const request = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(path, {
      method,
      headers: { "content-type": "application/json", cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const setCookie = res.headers.get("set-cookie")
    if (setCookie) cookie = setCookie.split(";")[0] ?? ""
    return res
  }
  return { request }
}

describe("http", () => {
  test("healthz checks the database and every response carries the CSP", async () => {
    const res = await client().request("GET", "/healthz")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors https://hub.cds.com.br")
  })

  test("setup, me, logout", async () => {
    const { request } = client()
    expect(await (await request("GET", "/api/setup")).json()).toEqual({ needed: true })
    expect((await request("POST", "/api/setup", admin)).status).toBe(204)
    expect(await (await request("GET", "/api/me")).json()).toMatchObject({
      email: admin.email,
      role: "admin",
    })
    expect((await request("DELETE", "/api/session")).status).toBe(204)
    const res = await request("GET", "/api/me")
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { code: "unauthorized", message: expect.any(String) } })
  })

  test("secure mode uses a __Host- cookie with SameSite=None for the iframe", async () => {
    const res = await client(true).request("POST", "/api/setup", admin)
    const cookie = res.headers.get("set-cookie") ?? ""
    expect(cookie).toMatch(/^__Host-mf_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Secure/i)
    expect(cookie).toMatch(/SameSite=None/i)
  })

  test("rejects cross-site writes", async () => {
    const { request } = client()
    await request("POST", "/api/setup", admin)
    const attacks: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
    ]
    for (const headers of attacks) {
      const res = await request("POST", "/api/projects", { key: "PLAT", name: "x" }, headers)
      expect(res.status).toBe(403)
    }
  })

  test("rate limits failed logins per IP", async () => {
    const { request } = client()
    await request("POST", "/api/setup", admin)
    const attempt = () =>
      request("POST", "/api/session", { email: admin.email, password: "senha-errada-123" })
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401)
    expect((await attempt()).status).toBe(429)
  })

  test("only admins create users", async () => {
    const adminClient = client()
    await adminClient.request("POST", "/api/setup", admin)
    const member = { name: "Bia", email: "bia@example.com", password: "senha-segura-456" }
    expect((await adminClient.request("POST", "/api/users", member)).status).toBe(201)
    const memberClient = client()
    await memberClient.request("POST", "/api/session", member)
    const res = await memberClient.request("POST", "/api/users", { ...member, email: "c@example.com" })
    expect(res.status).toBe(403)
  })

  test("projects and the empty board", async () => {
    const { request } = client()
    await request("POST", "/api/setup", admin)
    expect((await request("POST", "/api/projects", { key: "plat", name: "Plataforma" })).status).toBe(201)
    const invalid = await request("POST", "/api/projects", { key: "x", name: "" })
    expect(invalid.status).toBe(422)
    expect(await invalid.json()).toMatchObject({ error: { code: "validation" } })
    expect(await (await request("GET", "/api/projects")).json()).toMatchObject([{ key: "PLAT" }])
    expect(await (await request("GET", "/api/projects/PLAT/board")).json()).toMatchObject({
      project: { key: "PLAT", wipLimits: { in_progress: 3, review: 2 } },
      columns: { idea: [], ready: [], in_progress: [], review: [], done: [] },
    })
    expect((await request("GET", "/api/projects/NOPE/board")).status).toBe(404)
  })

  test("issues through the API: create, criteria, move with documented error codes", async () => {
    const { request } = client()
    await request("POST", "/api/setup", admin)
    await request("POST", "/api/projects", { key: "PLAT", name: "Plataforma" })

    const created = await request("POST", "/api/projects/PLAT/issues", { title: "Capturada" })
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ ref: "PLAT-1", status: "idea" })

    const skip = await request("POST", "/api/issues/PLAT-1/move", { status: "ready" })
    expect(skip.status).toBe(422)
    expect(await skip.json()).toMatchObject({ error: { code: "criteria_required" } })

    const criterion = await request("POST", "/api/issues/PLAT-1/criteria", { text: "Responde 200" })
    expect(criterion.status).toBe(201)
    const { id } = (await criterion.json()) as { id: number }
    expect((await request("POST", "/api/issues/PLAT-1/move", { status: "review" })).status).toBe(200)
    const reject = await request("POST", "/api/issues/PLAT-1/move", { status: "in_progress" })
    expect(reject.status).toBe(422)
    expect(await reject.json()).toMatchObject({ error: { code: "note_required" } })

    expect((await request("PATCH", `/api/issues/PLAT-1/criteria/${id}`, { checked: true })).status).toBe(200)
    expect((await request("POST", "/api/issues/PLAT-1/move", { status: "done" })).status).toBe(200)
    expect(await (await request("GET", "/api/issues/PLAT-1")).json()).toMatchObject({
      ref: "PLAT-1",
      status: "done",
      criteria: [{ text: "Responde 200", checked: true }],
    })
    expect(await (await request("GET", "/api/projects/PLAT/board")).json()).toMatchObject({
      columns: { done: [{ ref: "PLAT-1", criteriaTotal: 1, criteriaChecked: 1 }] },
    })
    expect((await request("DELETE", `/api/issues/PLAT-1/criteria/${id}`)).status).toBe(422)
    expect((await request("GET", "/api/issues/NOPE-1")).status).toBe(404)
  })

  test("WIP limits: PATCH the project, then a full column answers 409 wip_limit", async () => {
    const { request } = client()
    await request("POST", "/api/setup", admin)
    await request("POST", "/api/projects", { key: "PLAT", name: "Plataforma" })
    const patched = await request("PATCH", "/api/projects/PLAT", { wipLimits: { review: 1 } })
    expect(await patched.json()).toMatchObject({ wipLimits: { in_progress: 3, review: 1 } })
    expect((await request("PATCH", "/api/projects/PLAT", { wipLimits: { review: 0 } })).status).toBe(422)

    for (const title of ["A", "B"]) {
      await request("POST", "/api/projects/PLAT/issues", { title, criteria: [{ text: "ok" }] })
    }
    expect((await request("POST", "/api/issues/PLAT-1/move", { status: "review" })).status).toBe(200)
    const full = await request("POST", "/api/issues/PLAT-2/move", { status: "review" })
    expect(full.status).toBe(409)
    expect(await full.json()).toEqual({
      error: { code: "wip_limit", message: expect.stringContaining("1/1") },
    })
  })
})
