import { sql } from "drizzle-orm"
import { bigint, check, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"

const id = () => bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity()
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow()

export const ROLES = ["admin", "member"] as const

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_uidx").on(sql`lower(${t.email})`),
    check("users_role_check", sql`${t.role} in ('admin', 'member')`),
  ],
)

export const sessions = pgTable("sessions", {
  // SHA-256 hex of the cookie token; the raw token is never stored.
  tokenHash: text("token_hash").primaryKey(),
  userId: bigint("user_id", { mode: "number" })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
})

export type WipLimits = Partial<Record<"in_progress" | "review", number>>

export const projects = pgTable(
  "projects",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    repoFullName: text("repo_full_name"),
    wipLimits: jsonb("wip_limits").$type<WipLimits>().notNull().default({ in_progress: 3, review: 2 }),
    nextIssueNumber: integer("next_issue_number").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [check("projects_key_check", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`)],
)
