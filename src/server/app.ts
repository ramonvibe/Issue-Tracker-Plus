import { getConnInfo } from "@hono/node-server/conninfo"
import { serveStatic } from "@hono/node-server/serve-static"
import { zValidator } from "@hono/zod-validator"
import { sql } from "drizzle-orm"
import { type Context, Hono, type MiddlewareHandler } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { HTTPException } from "hono/http-exception"
import type { z } from "zod"
import {
  createUser,
  login,
  loginInput,
  logout,
  SESSION_TTL_SECONDS,
  type SessionUser,
  sessionUser,
  setup,
  setupInput,
  setupNeeded,
  userInput,
} from "./auth.ts"
import type { DB } from "./db.ts"
import { AppError } from "./errors.ts"
import {
  addCriterion,
  board,
  createIssue,
  criterionInput,
  criterionPatch,
  deleteCriterion,
  getIssue,
  issueInput,
  moveInput,
  moveIssue,
  updateCriterion,
} from "./issues.ts"
import { createProject, listProjects, projectInput, projectPatch, updateProject } from "./projects.ts"

export type AppConfig = {
  db: DB
  // True when served over HTTPS: Secure + SameSite=None cookies, required inside the hub.cds.com.br iframe.
  secureCookies: boolean
  staticDir?: string
}

type Env = { Variables: { user: SessionUser } }

const actor = (c: Context<Env>) => ({ userId: c.get("user").id })
const criterionId = (c: Context) => {
  const id = Number(c.req.param("id"))
  if (!Number.isSafeInteger(id) || id < 1) throw new AppError(404, "not_found", "Critério não encontrado")
  return id
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; frame-ancestors https://hub.cds.com.br; form-action 'self'"

const MAX_LOGIN_FAILURES = 10
const LOGIN_WINDOW_MS = 15 * 60 * 1000

const json = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result) => {
    if (!result.success) {
      throw new AppError(422, "validation", result.error.issues[0]?.message ?? "Dados inválidos")
    }
  })

export function createApp({ db, secureCookies, staticDir }: AppConfig) {
  const cookieName = secureCookies ? "__Host-mf_session" : "mf_session"
  const failures = new Map<string, { count: number; resetAt: number }>()

  const startSession = (c: Context, token: string) =>
    setCookie(c, cookieName, token, {
      path: "/",
      httpOnly: true,
      secure: secureCookies,
      // None is needed for the cross-site iframe; CSRF is covered by sameOriginWrites, not by the cookie.
      sameSite: secureCookies ? "None" : "Lax",
      maxAge: SESSION_TTL_SECONDS,
    })

  // shortcut: keyed by the socket address, so behind a reverse proxy every user shares one bucket;
  // read X-Forwarded-For from a trusted proxy when the app is deployed behind one.
  const clientIp = (c: Context) => {
    try {
      return getConnInfo(c).remote.address ?? "unknown"
    } catch {
      return "unknown"
    }
  }

  const loginLimit: MiddlewareHandler = async (c, next) => {
    const ip = clientIp(c)
    const now = Date.now()
    const entry = failures.get(ip)
    if (entry && entry.resetAt > now && entry.count >= MAX_LOGIN_FAILURES) {
      throw new AppError(429, "rate_limited", "Muitas tentativas. Tente novamente em alguns minutos")
    }
    await next()
    if (c.res.status === 401) {
      if (failures.size >= 4096) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
      const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + LOGIN_WINDOW_MS }
      failures.set(ip, { ...current, count: current.count + 1 })
    } else if (c.res.ok) {
      failures.delete(ip)
    }
  }

  const requireUser: MiddlewareHandler<Env> = async (c, next) => {
    const token = getCookie(c, cookieName)
    const user = token ? await sessionUser(db, token) : null
    if (!user) throw new AppError(401, "unauthorized", "Faça login para continuar")
    c.set("user", user)
    await next()
  }

  const api = new Hono<Env>()
    // Public routes. Everything registered after `requireUser` needs a session.
    .get("/setup", async (c) => c.json({ needed: await setupNeeded(db) }))
    .post("/setup", json(setupInput), async (c) => {
      startSession(c, await setup(db, c.req.valid("json")))
      return c.body(null, 204)
    })
    .post("/session", loginLimit, json(loginInput), async (c) => {
      const { email, password } = c.req.valid("json")
      startSession(c, await login(db, email, password))
      return c.body(null, 204)
    })
    .use(requireUser)
    .delete("/session", async (c) => {
      await logout(db, getCookie(c, cookieName) ?? "")
      deleteCookie(c, cookieName, { path: "/", secure: secureCookies })
      return c.body(null, 204)
    })
    .get("/me", (c) => c.json(c.get("user")))
    .post("/users", json(userInput), async (c) => {
      if (c.get("user").role !== "admin") throw new AppError(403, "forbidden", "Apenas administradores")
      return c.json(await createUser(db, c.req.valid("json")), 201)
    })
    .get("/projects", async (c) => c.json(await listProjects(db)))
    .post("/projects", json(projectInput), async (c) =>
      c.json(await createProject(db, c.req.valid("json")), 201),
    )
    .patch("/projects/:key", json(projectPatch), async (c) =>
      c.json(await updateProject(db, c.req.param("key"), c.req.valid("json"))),
    )
    .get("/projects/:key/board", async (c) => c.json(await board(db, c.req.param("key"))))
    .post("/projects/:key/issues", json(issueInput), async (c) =>
      c.json(await createIssue(db, c.req.param("key"), c.req.valid("json"), actor(c)), 201),
    )
    .get("/issues/:ref", async (c) => c.json(await getIssue(db, c.req.param("ref"))))
    .post("/issues/:ref/move", json(moveInput), async (c) =>
      c.json(await moveIssue(db, c.req.param("ref"), c.req.valid("json"), actor(c))),
    )
    .post("/issues/:ref/criteria", json(criterionInput), async (c) =>
      c.json(await addCriterion(db, c.req.param("ref"), c.req.valid("json"), actor(c)), 201),
    )
    .patch("/issues/:ref/criteria/:id", json(criterionPatch), async (c) =>
      c.json(await updateCriterion(db, c.req.param("ref"), criterionId(c), c.req.valid("json"), actor(c))),
    )
    .delete("/issues/:ref/criteria/:id", async (c) => {
      await deleteCriterion(db, c.req.param("ref"), criterionId(c), actor(c))
      return c.body(null, 204)
    })

  const app = new Hono()
  app.use(async (c, next) => {
    await next()
    c.header("Content-Security-Policy", CSP)
    c.header("X-Content-Type-Options", "nosniff")
    c.header("Referrer-Policy", "same-origin")
    if (!c.req.path.startsWith("/assets/")) c.header("Cache-Control", "no-store")
  })
  // Same idea as Go's http.CrossOriginProtection: browsers send Sec-Fetch-Site; older ones send Origin.
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const site = c.req.header("sec-fetch-site")
      const origin = c.req.header("origin")
      const crossSite = site
        ? site !== "same-origin" && site !== "none"
        : origin !== undefined && new URL(origin).host !== c.req.header("host")
      if (crossSite) throw new AppError(403, "cross_origin", "Requisição de outra origem bloqueada")
    }
    await next()
  })
  app.get("/healthz", async (c) => {
    await db.execute(sql`select 1`)
    return c.text("ok\n")
  })
  const routes = app.route("/api", api)
  app.all("/api/*", () => {
    throw new AppError(404, "not_found", "Rota não encontrada")
  })
  if (staticDir) {
    app.use("/assets/*", async (c, next) => {
      await next()
      c.header("Cache-Control", "public, max-age=31536000, immutable")
    })
    app.use("*", serveStatic({ root: staticDir }))
    // SPA fallback: client-side routes like /PLAT and /PLAT-142 get index.html.
    app.get("*", serveStatic({ path: `${staticDir}/index.html` }))
  }

  app.onError((error, c) => {
    if (error instanceof AppError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status)
    }
    if (error instanceof HTTPException && error.status < 500) {
      return c.json({ error: { code: "bad_request", message: error.message } }, error.status)
    }
    console.error(error)
    return c.json({ error: { code: "internal", message: "Erro interno do servidor" } }, 500)
  })
  return routes
}

export type AppType = ReturnType<typeof createApp>
